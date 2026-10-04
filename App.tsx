import { memo, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  type GestureResponderEvent,
  PanResponder,
  type PanResponderGestureState,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import MaskedView from '@react-native-masked-view/masked-view';
import { Image as ExpoImage } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import Svg, { Path } from 'react-native-svg';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://147.93.10.249:8787';

const COLORS = {
  ink: '#160B0D', background: '#100709', surface: '#241014', text: '#FFF4F3',
  coral: '#E5484D', muted: '#B9A5A7', white: '#FFF9F8',
};

type ShapeName = 'squircle' | 'heart' | 'star' | 'circle' | 'soft-square' | 'square';
type FeedPost = {
  id: string; mine: boolean; senderName: string; photoPath: string; message: string; shape: ShapeName;
  createdAt: number; expiresAt: number; openedAt: number | null; reaction: string | null;
  stickers: Placement[];
};
// Sticker colado na foto: x/y = centro, de 0 a 1 dentro do quadrado da foto.
type Placement = { id: string; stickerId: string; path: string; mine: boolean; x: number; y: number; scale: number; rotation: number };
type PlacementActions = {
  move: (postId: string, id: string, next: Pick<Placement, 'x' | 'y' | 'scale' | 'rotation'>) => void;
  remove: (postId: string, id: string) => void;
  dragging: (active: boolean, overTrash: boolean) => void;
  isOverTrash: (pageX: number, pageY: number) => boolean;
};
type Me = { name: string; code: string; partner: string | null };

async function api<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...init,
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(typeof init.body === 'string' && { 'content-type': 'application/json' }), ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'sem conexão');
  return body as T;
}

// Recorta o quadrado do centro (é o que a forma mostra) e reduz para 1080px:
// a foto fica ~10x menor que a original e o feed baixa quase na hora.
// `area` é o quadrado da foto em coordenadas da tela; a câmera mostra a foto ampliada para cobrir
// a tela (aspect fill), então convertemos para pixels da foto para recortar exatamente o que se via.
async function shrink(uri: string, area: { x: number; y: number; size: number }, screen: { width: number; height: number }) {
  const full = await ImageManipulator.manipulate(uri).renderAsync();
  const scale = Math.max(screen.width / full.width, screen.height / full.height);
  const offsetX = (screen.width - full.width * scale) / 2, offsetY = (screen.height - full.height * scale) / 2;
  const side = Math.min(area.size / scale, full.width, full.height);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  const square = await ImageManipulator.manipulate(full)
    .crop({
      originX: clamp((area.x - offsetX) / scale, full.width - side),
      originY: clamp((area.y - offsetY) / scale, full.height - side),
      width: side, height: side,
    })
    .resize({ width: 1080, height: 1080 })
    .renderAsync();
  return (await square.saveAsync({ compress: 0.8, format: SaveFormat.JPEG })).uri;
}

function timeAgo(createdAt: number) {
  const min = Math.floor((Date.now() - createdAt) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h`;
}

function ExpiryRing({ createdAt, expiresAt }: { createdAt: number; expiresAt: number }) {
  const left = Math.max(0, Math.min(1, (expiresAt - Date.now()) / (expiresAt - createdAt)));
  const c = 2 * Math.PI * 7;
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" accessibilityLabel="tempo restante">
      <Path d="M9 2 A7 7 0 1 1 8.99 2" fill="none" stroke="#FFFFFF24" strokeWidth={1.5} />
      <Path d="M9 2 A7 7 0 1 1 8.99 2" fill="none" stroke="#FFFFFFB0" strokeWidth={1.5} strokeLinecap="round" strokeDasharray={`${c * left} ${c}`} />
    </Svg>
  );
}

const SHAPES: { id: ShapeName; label: string }[] = [
  { id: 'squircle', label: 'instante' },
  { id: 'heart', label: 'coração' }, { id: 'star', label: 'estrela' },
  { id: 'circle', label: 'círculo' }, { id: 'soft-square', label: 'suave' },
  { id: 'square', label: 'quadrado' },
];

const ICONS = {
  close: 'M6 6 L18 18 M18 6 L6 18',
  send: 'M21 3 L10 14 M21 3 L14 21 L10 14 L3 10 Z',
  download: 'M12 4 V15 M7 10 L12 15 L17 10 M5 20 H19',
  plus: 'M12 5 V19 M5 12 H19',
  trash: 'M4 7 H20 M9 7 V4 H15 V7 M6 7 L7 20 H17 L18 7 M10 11 V16 M14 11 V16',
  flash: 'M13 2 L4 14 H12 L11 22 L20 10 H12 Z',
  flashOff: 'M13 2 L4 14 H12 L11 22 L20 10 H12 Z M3 3 L21 21',
  undo: 'M9 14 L4 9 L9 4 M4 9 H15 A5 5 0 0 1 15 19 H11',
  flip: 'M4 11 A8 8 0 0 1 18.5 7 M19 3 V7.5 H14.5 M20 13 A8 8 0 0 1 5.5 17 M5 21 V16.5 H9.5',
};

const SPRING = { useNativeDriver: true, damping: 18, stiffness: 220, mass: 0.8 };

function Icon({ d, size = 26, color = COLORS.white }: { d: string; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// O iOS devolve nomes como "Back Ultra Wide Camera", "Back Camera", "Back Telephoto Camera".
function lensLabel(lens: string) {
  if (/ultra\s*wide/i.test(lens)) return '0,5×';
  if (/tele/i.test(lens)) return '2×';
  return '1×';
}

// Câmeras virtuais (Dual/Triple) trocam de lente sozinhas; preferimos as lentes físicas.
const isVirtualLens = (lens: string) => /dual|triple|truedepth|lidar/i.test(lens);

// As formas são desenhadas em 0–300; o recorte 20–280 faz elas ocuparem a largura toda.
const VB_MIN = 20, VB_SIZE = 260, VIEWBOX = `${VB_MIN} ${VB_MIN} ${VB_SIZE} ${VB_SIZE}`;

function shapePath(shape: ShapeName) {
  switch (shape) {
    case 'heart': return 'M150 274 C128 250 42 188 42 112 C42 55 112 33 150 82 C188 33 258 55 258 112 C258 188 172 250 150 274 Z';
    case 'star': return 'M150 22 L182 108 L274 112 L202 169 L226 258 L150 207 L74 258 L98 169 L26 112 L118 108 Z';
    case 'circle': return 'M150 24 A126 126 0 1 1 149.9 24 Z';
    case 'soft-square': return 'M62 28 H238 Q272 28 272 62 V238 Q272 272 238 272 H62 Q28 272 28 238 V62 Q28 28 62 28 Z';
    case 'square': return 'M28 28 H272 V272 H28 Z';
    case 'squircle': return 'M150 30 C244 30 272 50 272 150 C272 250 244 270 150 270 C56 270 28 250 28 150 C28 50 56 30 150 30 Z';
  }
}

const holeTransform = (hole: { x: number; y: number; w: number }) =>
  `translate(${hole.x - VB_MIN * hole.w / VB_SIZE} ${hole.y - VB_MIN * hole.w / VB_SIZE}) scale(${hole.w / VB_SIZE})`;

// A forma desenhada na posição da tela onde está o buraco da câmera.
function ShapeAt({ hole, shape }: { hole: { x: number; y: number; w: number }; shape: ShapeName }) {
  return <Svg style={StyleSheet.absoluteFill}><Path d={shapePath(shape)} fill="#000000" transform={holeTransform(hole)} /></Svg>;
}


// Foto recortada na forma. Imagem nativa (expo-image, com cache) mascarada pelo desenho da forma:
// a imagem dentro do SVG só aparecia quando a tela era redesenhada.
function ShapePreview({ uri, shape, soft = false }: { uri: string; shape: ShapeName; soft?: boolean }) {
  return (
    <MaskedView
      style={StyleSheet.absoluteFill}
      maskElement={<Svg width="100%" height="100%" viewBox={VIEWBOX}><Path d={shapePath(shape)} fill="#000000" /></Svg>}
    >
      <ExpoImage source={{ uri }} style={styles.photoFill} contentFit="cover" cachePolicy="memory-disk" transition={0} blurRadius={soft ? 16 : 0} />
      {soft && <View style={[StyleSheet.absoluteFill, styles.softShade]} />}
    </MaskedView>
  );
}

// Cartão da pilha do feed. `pos` é a profundidade: -1 saindo, 0 frente, 1 e 2 atrás, 3+ escondido.
// Todo estilo vem de interpolações do mesmo valor: nunca alternar entre valor animado e fixo,
// senão o iOS mantém o último valor da animação (foto da frente borrada ou invisível).
// Sticker colado na foto. Um dedo arrasta; dois dedos aumentam/diminuem e giram.
// Ao segurar ele "levita"; arrastar até a lixeira que aparece embaixo apaga.
function PlacedSticker({ postId, placement, uri, box, editable, actions }: {
  postId: string; placement: Placement; uri: string; box: number; editable: boolean; actions: { current: PlacementActions };
}) {
  const drag = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(placement.scale)).current;
  const rotation = useRef(new Animated.Value(placement.rotation)).current;
  const lift = useRef(new Animated.Value(0)).current; // 0 parado, 1 levitando
  const bob = useRef(new Animated.Value(0)).current;
  const live = useRef(placement);
  live.current = placement;
  const pan = useMemo(() => {
    // Estado do gesto: translação acumulada, escala/rotação atuais e o "ponto de partida" de cada fase.
    let tx = 0, ty = 0, sc = 1, rot = 0, base = { tx: 0, ty: 0, cx: 0, cy: 0, n: 0 };
    let pinch: { dist: number; ang: number; sc: number; rot: number } | null = null;
    let overTrash = false;
    let loop: Animated.CompositeAnimation | undefined;
    const touchesOf = (e: GestureResponderEvent) => e.nativeEvent.touches;
    const centroid = (t: ReturnType<typeof touchesOf>) => ({
      cx: t.reduce((sum, p) => sum + p.pageX, 0) / t.length, cy: t.reduce((sum, p) => sum + p.pageY, 0) / t.length,
    });
    const rebase = (t: ReturnType<typeof touchesOf>) => {
      const c = centroid(t);
      base = { tx, ty, ...c, n: t.length };
      pinch = t.length >= 2 ? {
        dist: Math.hypot(t[1].pageX - t[0].pageX, t[1].pageY - t[0].pageY) || 1,
        ang: Math.atan2(t[1].pageY - t[0].pageY, t[1].pageX - t[0].pageX), sc, rot,
      } : null;
    };
    const land = () => {
      loop?.stop();
      Animated.parallel([
        Animated.spring(lift, { toValue: 0, useNativeDriver: false, friction: 6 }),
        Animated.timing(bob, { toValue: 0, duration: 120, useNativeDriver: false }),
      ]).start();
      actions.current.dragging(false, false);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => editable,
      onMoveShouldSetPanResponder: () => editable,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        tx = 0; ty = 0; sc = live.current.scale; rot = live.current.rotation; overTrash = false;
        rebase(touchesOf(e));
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.spring(lift, { toValue: 1, useNativeDriver: false, friction: 5, tension: 120 }).start();
        loop = Animated.loop(Animated.sequence([
          Animated.timing(bob, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
          Animated.timing(bob, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        ]));
        loop.start();
        actions.current.dragging(true, false);
      },
      onPanResponderMove: (e) => {
        const t = touchesOf(e);
        if (!t.length) return;
        if (t.length !== base.n) rebase(t); // entrou/saiu um dedo: recomeça a partir daqui, sem pulo
        const c = centroid(t);
        tx = base.tx + c.cx - base.cx; ty = base.ty + c.cy - base.cy;
        drag.setValue({ x: tx, y: ty });
        if (pinch && t.length >= 2) {
          const dist = Math.hypot(t[1].pageX - t[0].pageX, t[1].pageY - t[0].pageY);
          const ang = Math.atan2(t[1].pageY - t[0].pageY, t[1].pageX - t[0].pageX);
          sc = Math.max(STICKER_MIN, Math.min(STICKER_MAX, pinch.sc * dist / pinch.dist));
          rot = pinch.rot + (ang - pinch.ang) * 180 / Math.PI;
          scale.setValue(sc);
          rotation.setValue(rot);
        }
        const over = t.length === 1 && actions.current.isOverTrash(c.cx, c.cy);
        if (over !== overTrash) {
          overTrash = over;
          if (over) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          actions.current.dragging(true, over);
        }
      },
      onPanResponderRelease: () => {
        land();
        if (overTrash) {
          // Some encolhendo dentro da lixeira.
          Animated.timing(scale, { toValue: 0, duration: 180, useNativeDriver: false }).start(() => actions.current.remove(postId, live.current.id));
          return;
        }
        const clamp = (v: number) => Math.max(0, Math.min(1, v));
        const next = { x: clamp(live.current.x + tx / box), y: clamp(live.current.y + ty / box), scale: sc, rotation: rot % 360 };
        const cur = live.current;
        if (next.x === cur.x && next.y === cur.y && next.scale === cur.scale && next.rotation === cur.rotation) drag.setValue({ x: 0, y: 0 });
        else actions.current.move(postId, cur.id, next);
      },
      onPanResponderTerminate: () => {
        land();
        drag.setValue({ x: 0, y: 0 });
        scale.setValue(live.current.scale);
        rotation.setValue(live.current.rotation);
      },
    });
  }, [editable, box, postId]);
  // A nova posição já veio no estado: zera o arraste no mesmo frame, sem pulo.
  useLayoutEffect(() => {
    drag.setValue({ x: 0, y: 0 });
    scale.setValue(placement.scale);
    rotation.setValue(placement.rotation);
  }, [placement.x, placement.y, placement.scale, placement.rotation]);
  const size = box * STICKER_SIZE;
  return (
    <Animated.View
      {...pan.panHandlers}
      pointerEvents={editable ? 'auto' : 'none'}
      style={{
        position: 'absolute', left: placement.x * box - size / 2, top: placement.y * box - size / 2, width: size, height: size,
        shadowColor: '#000000', shadowOffset: { width: 0, height: 14 }, shadowRadius: 16,
        shadowOpacity: lift.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }),
        transform: [
          { translateX: drag.x },
          { translateY: Animated.add(drag.y, Animated.multiply(lift, bob.interpolate({ inputRange: [0, 1], outputRange: [-6, -12] }))) },
          { rotate: rotation.interpolate({ inputRange: [-3600, 3600], outputRange: ['-3600deg', '3600deg'] }) },
          { scale: Animated.multiply(scale, lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] })) },
        ],
      }}
    >
      <ExpoImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" transition={0} />
    </Animated.View>
  );
}

// Lixeira que aparece embaixo enquanto um sticker está sendo arrastado.
function TrashZone({ visible, hot }: { visible: boolean; hot: boolean }) {
  const show = useRef(new Animated.Value(0)).current;
  const heat = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(show, { toValue: visible ? 1 : 0, useNativeDriver: true, friction: 7 }).start(); }, [visible]);
  useEffect(() => { Animated.spring(heat, { toValue: hot ? 1 : 0, useNativeDriver: true, friction: 5 }).start(); }, [hot]);
  return (
    <Animated.View pointerEvents="none" style={[styles.trash, {
      opacity: show,
      transform: [
        { translateY: show.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
        { scale: heat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) },
      ],
    }]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.trashHot, { opacity: heat }]} />
      <Icon d={ICONS.trash} size={26} />
    </Animated.View>
  );
}

const STICKER_SIZE = 0.32; // tamanho do sticker (escala 1) em relação à largura da foto
const TRASH_SIZE = 64, TRASH_BOTTOM = 56;
const STICKER_MIN = 0.4, STICKER_MAX = 2.4; // no máximo ~3/4 da largura da foto

const DeckCard = memo(function DeckCard({ pos, uri, shape, message, width, postId, placements, box, editable, actions }: {
  pos: Animated.Value; uri: string; shape: ShapeName; message: string | null; width: number;
  postId: string; placements: Placement[]; box: number; editable: boolean; actions: { current: PlacementActions };
}) {
  const style = useMemo(() => {
    const at = (inputRange: number[], outputRange: number[] | string[]) => pos.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
    return {
      opacity: at([-1, -0.3, 2, 3], [0, 1, 1, 0]),
      transform: [
        { translateX: at([-1, 0, 1, 2], [-width, 0, 14, -16]) },
        { translateY: at([-1, 0, 1, 2], [0, 0, -24, -42]) },
        { rotate: at([-1, 0, 1, 2], ['-16deg', '0deg', '5deg', '-6deg']) },
        { scale: at([-1, 0, 1, 2, 3], [1, 1, 0.92, 0.85, 0.8]) },
      ],
    };
  }, [pos, width]);
  const soft = useMemo(() => pos.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), [pos]);
  return (
    <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <ShapePreview uri={uri} shape={shape} />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: soft }]}>
          <ShapePreview uri={uri} shape={shape} soft />
        </Animated.View>
        {!!message && <View style={styles.feedCaption}><Text style={styles.feedCaptionText}>{message}</Text></View>}
      </View>
      {placements.map((pl) => (
        // Cada um mexe só nos stickers que colou; os da outra pessoa aparecem, mas ficam fixos.
        <PlacedSticker key={pl.id} postId={postId} placement={pl} uri={API_URL + pl.path} box={box} editable={editable && pl.mine} actions={actions} />
      ))}
    </Animated.View>
  );
});

// Reações rápidas do arco (como no Instants): 😂 ❤️ [+] em cima, 🥹 🔥 embaixo. O "+" abre a aba de emojis e stickers.
const QUICK_REACTIONS = ['😂', '❤️', '🥹', '🔥'];
const QUICK_SPOTS = [{ left: 0, top: 30 }, { left: 82, top: 0 }, { left: 41, top: 96 }, { left: 123, top: 96 }];
const PLUS_SPOT = { left: 164, top: 30 };
const EMOJI_GRID = [
  '😂', '🤣', '😍', '🥰', '😘', '😊', '🥹', '😭', '😢', '😮', '😱', '🤯', '😎', '🤩', '😏', '😴',
  '🤤', '😋', '🤭', '🫣', '🙈', '👀', '🫶', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔',
  '🔥', '✨', '💯', '🎉', '👏', '🙌', '👍', '👎', '💪', '🙏', '🌸', '🌹', '🥐', '🍕', '☕', '🍷',
];

type Sticker = { id: string; path: string };

// Uma reação é um emoji ou "sticker:<id>" (imagem enviada pelo casal).
function ReactionGlyph({ value, stickers, size }: { value: string; stickers: Sticker[]; size: number }) {
  if (value.startsWith('sticker:')) {
    const sticker = stickers.find((s) => s.id === value.slice(8));
    return sticker ? <ExpoImage source={{ uri: API_URL + sticker.path }} style={{ width: size, height: size }} contentFit="contain" cachePolicy="memory-disk" /> : null;
  }
  return <Text style={{ fontSize: size * 0.82, lineHeight: size }}>{value}</Text>;
}

function ReactionButton({ children, active, dimmed, onPress, style, label }: { children: ReactNode; active: boolean; dimmed: boolean; onPress: () => void; style: object; label: string }) {
  const pop = useRef(new Animated.Value(1)).current;
  const press = () => {
    pop.setValue(0.75);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 3, tension: 180 }).start();
    onPress();
  };
  return (
    <Animated.View style={[styles.reactionSpot, style, { transform: [{ scale: pop }] }]}>
      <Pressable accessibilityLabel={label} style={[styles.reactionButton, active && styles.reactionActive, dimmed && styles.reactionDimmed]} onPress={press}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

// Aba de baixo com todos os emojis e os stickers do casal.
function ReactionSheet({ open, onClose, onPick, onPlace, stickers, onAddSticker, onDeleteSticker, adding }: {
  open: boolean; onClose: () => void; onPick: (value: string) => void; onPlace: (s: Sticker) => void; stickers: Sticker[];
  onAddSticker: () => void; onDeleteSticker: (s: Sticker) => void; adding: boolean;
}) {
  const [tab, setTab] = useState<'emojis' | 'stickers'>('emojis');
  const [mounted, setMounted] = useState(open);
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (open) setMounted(true);
    Animated.spring(y, { toValue: open ? 1 : 0, useNativeDriver: true, damping: 22, stiffness: 240, overshootClamping: !open })
      .start(({ finished }) => { if (finished && !open) setMounted(false); });
  }, [open]);
  if (!mounted) return null;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.sheetBackdrop, { opacity: y }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Fechar" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [520, 0] }) }] }]}>
        <View style={styles.sheetGrip} />
        <View style={styles.tabs}>
          {(['emojis', 'stickers'] as const).map((t) => (
            <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => { setTab(t); void Haptics.selectionAsync(); }}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'emojis' ? 'Emojis' : 'Stickers'}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {tab === 'emojis' ? EMOJI_GRID.map((e) => (
            <Pressable key={e} style={styles.gridCell} onPress={() => onPick(e)}><Text style={styles.gridEmoji}>{e}</Text></Pressable>
          )) : (
            <>
              <Pressable style={styles.stickerCell} onPress={onAddSticker} disabled={adding} accessibilityLabel="Adicionar sticker">
                <View style={styles.addSticker}>{adding ? <><ActivityIndicator color="#FFFFFF99" /><Text style={styles.addingText}>recortando…</Text></> : <Icon d={ICONS.plus} size={26} />}</View>
              </Pressable>
              {stickers.map((s) => (
                <Pressable key={s.id} style={styles.stickerCell} onPress={() => onPlace(s)} onLongPress={() => onDeleteSticker(s)}>
                  <ReactionGlyph value={`sticker:${s.id}`} stickers={stickers} size={64} />
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
        {tab === 'stickers' && <Text style={styles.sheetHint}>toque para colar na foto · o fundo é recortado sozinho · segure para apagar</Text>}
      </Animated.View>
    </View>
  );
}

function Burst({ value, stickers, id }: { value: string; stickers: Sticker[]; id: number }) {
  const parts = useMemo(() => Array.from({ length: 16 }, () => ({
    v: new Animated.Value(0), dx: (Math.random() - 0.5) * 280, dy: 260 + Math.random() * 260,
    rot: `${(Math.random() - 0.5) * 70}deg`, delay: Math.random() * 180, size: 24 + Math.random() * 20,
  })), [id]);
  useEffect(() => {
    Animated.parallel(parts.map((p) => Animated.timing(p.v, { toValue: 1, duration: 1200, delay: p.delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }))).start();
  }, [parts]);
  return (
    <View pointerEvents="none" style={styles.burst}>
      {parts.map((p, i) => (
        <Animated.View key={i} style={{
          position: 'absolute',
          opacity: p.v.interpolate({ inputRange: [0, 0.65, 1], outputRange: [1, 1, 0] }),
          transform: [
            { translateX: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
            { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, -p.dy] }) },
            { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', p.rot] }) },
            { scale: p.v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.2, 1.15, 0.85] }) },
          ],
        }}><ReactionGlyph value={value} stickers={stickers} size={p.size} /></Animated.View>
      ))}
    </View>
  );
}

function Onboarding({ onDone }: { onDone: (token: string) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || (joining && !code.trim())) return;
    setBusy(true);
    try {
      const { token } = await api<{ token: string }>(joining ? '/couples/join' : '/couples', null, {
        method: 'POST', body: JSON.stringify({ name, code }),
      });
      await SecureStore.setItemAsync('token', token);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone(token);
    } catch (e) {
      Alert.alert('Não deu certo', (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.permissionScreen}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.onboarding}>
        <Text style={styles.permissionEyebrow}>SÓ ENTRE NÓS</Text>
        <Text style={styles.permissionTitle}>Como você se chama?</Text>
        <TextInput value={name} onChangeText={setName} placeholder="seu nome" placeholderTextColor="#806F72" style={styles.field} maxLength={30} autoFocus />
        {joining && (
          <TextInput value={code} onChangeText={setCode} placeholder="código que você recebeu" placeholderTextColor="#806F72" style={styles.field} autoCapitalize="characters" maxLength={6} />
        )}
        <Pressable style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.8 }]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.primaryButtonText}>{joining ? 'Entrar' : 'Criar nosso espaço'}</Text>}
        </Pressable>
        <Pressable hitSlop={12} onPress={() => setJoining((v) => !v)}>
          <Text style={styles.linkText}>{joining ? 'quero criar um novo' : 'recebi um código'}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const run = (animation: Animated.CompositeAnimation) => new Promise<void>((resolve) => animation.start(() => resolve()));

export default function App() {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const cameraRef = useRef<CameraView>(null);
  const feedTranslateY = useRef(new Animated.Value(-Dimensions.get('window').height)).current; // feed fica pronto, escondido acima da tela
  const flash = useRef(new Animated.Value(0)).current;
  const fly = useRef(new Animated.Value(0)).current;
  const undoPill = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  // Virada 3D ao trocar de câmera: -1 de lado (voltando), 0 reto, 1 de lado (indo). JS driver: ver toggleFacing.
  const flip = useRef(new Animated.Value(0)).current;
  const flipCover = useRef(new Animated.Value(0)).current; // preto por cima enquanto a câmera troca, reta
  const shutterPress = useRef(new Animated.Value(1)).current;
  const toast = useRef(new Animated.Value(0)).current;
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flashOn, setFlashOn] = useState(false);
  const [ready, setReady] = useState<Set<string>>(new Set()); // fotos do feed já baixadas
  const [availableLenses, setAvailableLenses] = useState<string[]>([]);
  const [selectedLens, setSelectedLens] = useState<string>();
  const [shapeIndex, setShapeIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [burst, setBurst] = useState<{ emoji: string; id: number } | null>(null);
  const deckPos = useRef(new Map<string, Animated.Value>()).current;
  const localUris = useRef(new Map<string, string>()).current; // foto recém-enviada aparece na hora, sem baixar
  const deckBusy = useRef(false);
  const [flying, setFlying] = useState<string | null>(null);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const pendingSend = useRef<Promise<string> | null>(null); // envio que o "Desfazer" pode cancelar
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [showFeed, setShowFeed] = useState(false);
  const [feedFull, setFeedFull] = useState(false);
  const [hole, setHole] = useState<{ x: number; y: number; w: number } | null>(null);
  const guideRef = useRef<View>(null);
  const [toastText, setToastText] = useState('');
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addingSticker, setAddingSticker] = useState(false);

  // Sticker: imagem da galeria recortada em quadrado, reduzida para 512px e guardada no servidor para o casal.
  const addSticker = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (picked.canceled) return;
    setAddingSticker(true);
    try {
      const img = await ImageManipulator.manipulate(picked.assets[0].uri).resize({ width: 768, height: 768 }).renderAsync();
      const { uri } = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
      const blob = await (await fetch(uri)).blob();
      // O servidor recorta o fundo automaticamente e devolve um PNG transparente.
      const sticker = await api<Sticker>('/stickers', token!, { method: 'POST', body: blob, headers: { 'content-type': 'image/jpeg' } });
      setStickers((list) => [sticker, ...list]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Não deu para adicionar', (e as Error).message);
    } finally { setAddingSticker(false); }
  };

  const updatePost = (postId: string, change: (p: FeedPost) => FeedPost) =>
    setPosts((list) => list.map((p) => p.id === postId ? change(p) : p));

  const placeSticker = (postId: string, sticker: Sticker) => {
    const stickerId = sticker.id;
    const temp = { id: `tmp-${Date.now()}`, stickerId, path: sticker.path, mine: true, x: 0.5, y: 0.5, scale: 1, rotation: 0 };
    updatePost(postId, (p) => ({ ...p, stickers: [...(p.stickers ?? []), temp] }));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    api<{ id: string }>(`/posts/${postId}/stickers`, token!, { method: 'POST', body: JSON.stringify({ stickerId, x: 0.5, y: 0.5 }) })
      .then(({ id }) => {
        let moved: Placement | undefined;
        updatePost(postId, (p) => ({ ...p, stickers: p.stickers.map((pl) => pl.id === temp.id ? (moved = { ...pl, id }) : pl) }));
        // Se arrastou antes do servidor responder, manda a posição final.
        setTimeout(() => moved && (moved.x !== 0.5 || moved.y !== 0.5 || moved.scale !== 1 || moved.rotation !== 0) && placementActions.current.move(postId, id, moved));
      })
      .catch(() => refresh());
  };

  // Ações dos stickers colados: num ref para os cartões (memo) não redesenharem a cada mudança.
  const placementActions = useRef<PlacementActions>(null as unknown as PlacementActions);
  const [stickerDrag, setStickerDrag] = useState({ active: false, overTrash: false });
  placementActions.current = {
    move: (postId, id, next) => {
      updatePost(postId, (p) => ({ ...p, stickers: p.stickers.map((pl) => pl.id === id ? { ...pl, ...next } : pl) }));
      if (!id.startsWith('tmp-')) void api(`/posts/${postId}/stickers/${id}`, token!, { method: 'PATCH', body: JSON.stringify(next) }).catch(() => refresh());
    },
    remove: (postId, id) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      updatePost(postId, (p) => ({ ...p, stickers: p.stickers.filter((pl) => pl.id !== id) }));
      if (!id.startsWith('tmp-')) void api(`/posts/${postId}/stickers/${id}`, token!, { method: 'DELETE' }).catch(() => refresh());
    },
    dragging: (active, overTrash) => setStickerDrag((d) => d.active === active && d.overTrash === overTrash ? d : { active, overTrash }),
    // Lixeira: círculo no centro, perto do pé da tela (mesma posição do estilo `trash`).
    isOverTrash: (x, y) => Math.hypot(x - screenWidth / 2, y - (screenHeight - TRASH_BOTTOM - TRASH_SIZE / 2)) < TRASH_SIZE,
  };

  const deleteSticker = (sticker: Sticker) => {
    Alert.alert('Apagar sticker?', 'Ele sai da sua coleção e das fotos onde foi colado.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar', style: 'destructive', onPress: () => {
          setStickers((list) => list.filter((s) => s.id !== sticker.id));
          void api(`/stickers/${sticker.id}`, token!, { method: 'DELETE' }).catch(() => refresh());
        },
      },
    ]);
  };
  const shape = SHAPES[shapeIndex];
  const hasNew = posts.some((p) => !p.mine && !p.openedAt);
  const current = posts.length ? posts[index % posts.length] : null;
  const allReady = posts.every((p) => ready.has(p.id) || localUris.has(p.id));

  useEffect(() => { SecureStore.getItemAsync('token').then(setToken, () => setToken(null)); }, []);

  const refresh = async () => {
    if (!token) return;
    try {
      const [feed, profile, stickerList] = await Promise.all([api<FeedPost[]>('/feed', token), api<Me>('/me', token), api<Sticker[]>('/stickers', token)]);
      if (stickerList.length) void ExpoImage.prefetch(stickerList.map((s) => API_URL + s.path), 'memory-disk').catch(() => {});
      setStickers(stickerList);
      // Baixa todas as fotos antes; o feed só mostra a pilha quando todas estiverem no cache.
      feed.forEach((p) => {
        ExpoImage.prefetch(API_URL + p.photoPath, 'memory-disk').catch(() => false)
          .then(() => setReady((prev) => prev.has(p.id) ? prev : new Set(prev).add(p.id)));
      });
      setPosts(feed);
      setMe(profile);
    } catch (e) {
      if ((e as Error).message === 'não autenticado') { await SecureStore.deleteItemAsync('token'); setToken(null); }
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 20000); // ponytail: polling; trocar por push quando houver build com notificações
    return () => clearInterval(timer);
  }, [token]);

  useEffect(() => {
    if (!showFeed || !token) return;
    const unopened = posts.filter((p) => !p.mine && !p.openedAt);
    if (!unopened.length) return;
    Promise.all(unopened.map((p) => api(`/posts/${p.id}/open`, token, { method: 'POST' }))).then(refresh, () => {});
  }, [showFeed, posts]);

  const react = async (post: FeedPost, emoji: string) => {
    void Haptics.selectionAsync();
    const next = post.reaction === emoji ? null : emoji;
    if (next) {
      setBurst({ emoji: next, id: Date.now() });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setPosts((list) => list.map((p) => p.id === post.id ? { ...p, reaction: next } : p));
    await api(`/posts/${post.id}/react`, token!, { method: 'POST', body: JSON.stringify({ emoji: next }) }).catch(() => refresh());
  };

  const depthOf = (i: number, idx: number, n: number) => (i - (idx % n) + n) % n;
  const posFor = (id: string, depth: number) => {
    let v = deckPos.get(id);
    if (!v) { v = new Animated.Value(Math.min(depth, 3)); deckPos.set(id, v); }
    return v;
  };
  const syncDeck = (list: FeedPost[], idx: number) => list.forEach((p, i) => posFor(p.id, 0).setValue(Math.min(depthOf(i, idx, list.length), 3)));

  const nextPost = () => {
    const n = posts.length;
    if (n < 2 || deckBusy.current) return;
    deckBusy.current = true;
    void Haptics.selectionAsync();
    setBurst(null);
    const front = posts[index % n];
    Animated.parallel(posts.map((p, i) => {
      const d = depthOf(i, index, n);
      return Animated.timing(posFor(p.id, d), { toValue: d === 0 ? -1 : Math.min(d - 1, 3), duration: 340, easing: Easing.inOut(Easing.cubic), useNativeDriver: true });
    })).start(() => {
      const v = posFor(front.id, 0);
      v.setValue(3); // volta invisível para o fundo e aparece suave atrás das outras
      Animated.timing(v, { toValue: Math.min(n - 1, 3), duration: 300, useNativeDriver: true }).start();
      setIndex((i) => (i + 1) % n);
      deckBusy.current = false;
    });
  };

  // Quando chegam/saem fotos, recomeça da mais nova com cada cartão na sua posição.
  const deckKey = posts.map((p) => p.id).join();
  useLayoutEffect(() => {
    setIndex(0);
    syncDeck(posts, 0);
  }, [deckKey]);

  // Segurar uma foto que você tirou: pergunta se quer excluir (some para os dois).
  const confirmDeletePost = (post: FeedPost) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Excluir foto?', 'Ela some do feed de vocês dois.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir', style: 'destructive', onPress: () => {
          setPosts((list) => list.filter((p) => p.id !== post.id));
          localUris.delete(post.id);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          api(`/posts/${post.id}`, token!, { method: 'DELETE' }).catch(() => {
            Alert.alert('Não deu para excluir', 'Tente de novo em instantes.');
            void refresh();
          });
        },
      },
    ]);
  };

  const nextShape = () => {
    void Haptics.selectionAsync();
    setShapeIndex((current) => (current + 1) % SHAPES.length);
  };

  const showToast = (text: string) => {
    setToastText(text);
    toast.setValue(0);
    Animated.sequence([
      Animated.spring(toast, { toValue: 1, ...SPRING }),
      Animated.delay(1300),
      Animated.timing(toast, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  };

  const hideUndo = () => {
    clearTimeout(undoTimer.current);
    Animated.timing(undoPill, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  };

  const send = (uri: string, shapeId: ShapeName, area?: { x: number; y: number; size: number }, screen?: { width: number; height: number }) => {
    let small = uri;
    const pending = (area && screen ? shrink(uri, area, screen) : Promise.resolve(uri))
      .then((out) => { small = out; return fetch(out); })
      .then((file) => file.blob())
      .then((blob) => api<{ id: string }>('/posts', token!, {
        method: 'POST', body: blob,
        headers: { 'content-type': 'image/jpeg', 'x-shape': shapeId, 'x-message': '' },
      }))
      .then(({ id }) => { localUris.set(id, small); void refresh(); return id; });
    pendingSend.current = pending;
    clearTimeout(undoTimer.current);
    Animated.spring(undoPill, { toValue: 1, ...SPRING }).start();
    undoTimer.current = setTimeout(hideUndo, 5000);
    pending.catch((e) => {
      if (pendingSend.current !== pending) return;
      pendingSend.current = null;
      hideUndo();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Não enviou', (e as Error).message, [
        { text: 'Descartar', style: 'cancel' },
        { text: 'Tentar de novo', onPress: () => send(small, shapeId) },
      ]);
    });
  };

  const undo = async () => {
    const pending = pendingSend.current;
    if (!pending) return;
    pendingSend.current = null;
    hideUndo();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const id = await pending;
      await api(`/posts/${id}`, token!, { method: 'DELETE' });
      localUris.delete(id);
      void refresh();
      showToast('foto desfeita');
    } catch {}
  };

  // Como no Instants: a foto congela na forma, encolhe e sobe (para o feed) enquanto é enviada.
  const launched = useRef(false);
  const launchFlight = () => {
    if (launched.current) return;
    launched.current = true;
    void cameraRef.current?.resumePreview();
    Animated.timing(fly, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start(() => setFlying(null));
  };

  const takePhoto = async () => {
    if (!cameraRef.current || takingPhoto) return;
    try {
      setTakingPhoto(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Na câmera frontal o "flash" é a própria tela acesa em branco durante a foto.
      const screenFlash = flashOn && facing === 'front';
      if (screenFlash) {
        flash.setValue(1);
        await new Promise((r) => setTimeout(r, 180));
      } else {
        flash.setValue(0.45);
        Animated.timing(flash, { toValue: 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      }
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (screenFlash) Animated.timing(flash, { toValue: 0, duration: 260, useNativeDriver: true }).start();
      if (!photo?.uri || !hole) return;
      // Congela a câmera até a foto original aparecer por cima, no mesmo lugar: a troca é invisível.
      void cameraRef.current.pausePreview();
      launched.current = false;
      fly.setValue(0);
      setFlying(photo.uri);
      setTimeout(launchFlight, 600); // garantia, caso a imagem demore a avisar que carregou
      // Recorte, redução e envio rodam em segundo plano; a animação não espera por eles.
      const unit = hole.w / VB_SIZE;
      send(photo.uri, shape.id, { x: hole.x - VB_MIN * unit, y: hole.y - VB_MIN * unit, size: 300 * unit }, { width: screenWidth, height: screenHeight });
    } catch {
      void cameraRef.current?.resumePreview();
      Alert.alert('Não deu para fotografar', 'Tente novamente em alguns instantes.');
    } finally { setTakingPhoto(false); }
  };

  const updateAvailableLenses = ({ lenses: all }: { lenses: string[] }) => {
    const physical = all.filter((lens) => !isVirtualLens(lens));
    const lenses = physical.length ? physical : all;
    const uniqueByLabel = lenses.reduce<string[]>((result, lens) => {
      const label = lensLabel(lens);
      if (!result.some((item) => lensLabel(item) === label)) result.push(lens);
      return result;
    }, []);
    const ordered = uniqueByLabel.sort((a, b) => {
      const order = ['0,5×', '1×', '2×'];
      return order.indexOf(lensLabel(a)) - order.indexOf(lensLabel(b));
    });
    setAvailableLenses(ordered);
    setSelectedLens((current) => {
      if (current && ordered.includes(current)) return current;
      return ordered.find((lens) => lensLabel(lens) === '1×') ?? ordered[0];
    });
  };

  // Virada 3D como no Instants: a forma gira até ficar de lado (90°), a câmera troca escondida
  // e a forma termina de girar mostrando a outra câmera.
  const flipping = useRef(false);
  const toggleFacing = () => {
    if (flipping.current) return;
    flipping.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: 520, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
    // A câmera NUNCA troca enquanto está girada: o iOS calcula o tamanho da imagem da câmera nova
    // no momento da troca e, com a vista de lado, ela ficava torta/fora do lugar.
    // Então: gira até ficar de lado → cobre de preto e endireita → troca → descobre de lado → termina o giro.
    flip.setValue(0);
    Animated.timing(flip, { toValue: 1, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: false }).start(() => {
      flipCover.setValue(1);
      flip.setValue(0);
      setFacing((current) => (current === 'back' ? 'front' : 'back'));
      setAvailableLenses([]);
      setSelectedLens(undefined);
      setTimeout(() => {
        flip.setValue(-1);
        flipCover.setValue(0);
        Animated.timing(flip, { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: false })
          .start(() => { flipping.current = false; });
      }, 260);
    });
  };

  // Gestos criados uma única vez; o estado atual chega por refs (recriar no meio do arraste fazia a tela tremer).
  const live = useRef({ showFeed, screenHeight, refresh, posts, sheetOpen });
  live.current = { showFeed, screenHeight, refresh, posts, sheetOpen };

  const settleFeed = (open: boolean, velocity = 0) => {
    if (!open) { setFeedFull(false); setSheetOpen(false); }
    Animated.spring(feedTranslateY, {
      toValue: open ? 0 : -live.current.screenHeight, velocity, useNativeDriver: true,
      damping: 24, stiffness: 210, mass: 0.9, overshootClamping: !open,
    }).start(({ finished }) => {
      if (!finished) return;
      if (open) { setFeedFull(true); void live.current.refresh(); } // atualiza só depois da animação, para não travar o gesto
      else setShowFeed(false);
    });
  };

  const openFeed = () => {
    void live.current.refresh();
    setIndex(0);
    syncDeck(live.current.posts, 0);
    feedTranslateY.setValue(-live.current.screenHeight);
    setShowFeed(true);
    requestAnimationFrame(() => settleFeed(true));
  };

  const closeFeed = () => settleFeed(false);

  // Puxar o feed: ele já está desenhado acima da tela, então o gesto só o move (nada é montado nem baixado no meio).
  // "Capture" faz o gesto vertical ganhar dos botões da câmera assim que o dedo desce um pouco.
  const wantsFeed = (g: PanResponderGestureState) => !live.current.showFeed && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.3;
  const cameraSwipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => wantsFeed(g),
    onMoveShouldSetPanResponder: (_, g) => wantsFeed(g),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => feedTranslateY.setValue(Math.min(0, -live.current.screenHeight + Math.max(0, g.dy) * 1.4)),
    onPanResponderRelease: (_, g) => {
      const open = g.dy > live.current.screenHeight * 0.15 || g.vy > 0.4;
      if (open) setShowFeed(true);
      settleFeed(open, g.vy);
    },
    onPanResponderTerminate: () => settleFeed(false),
  })).current;

  const feedSwipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => !live.current.sheetOpen && g.dy < -8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => setFeedFull(false),
    onPanResponderMove: (_, g) => feedTranslateY.setValue(Math.min(0, g.dy)),
    onPanResponderRelease: (_, g) => settleFeed(!(g.dy < -80 || g.vy < -0.5), g.vy),
    onPanResponderTerminate: () => settleFeed(true),
  })).current;

  const measureHole = () => guideRef.current?.measureInWindow((x, y, w) => setHole({ x, y, w }));

  if (!permission || token === undefined) return <View style={styles.permissionScreen}><ActivityIndicator color={COLORS.coral} /></View>;

  if (!token) return <Onboarding onDone={setToken} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <StatusBar style="light" />
        <View style={styles.permissionMark}><Text style={styles.permissionMarkText}>◌</Text></View>
        <Text style={styles.permissionEyebrow}>SÓ ENTRE NÓS</Text>
        <Text style={styles.permissionTitle}>Um pedacinho do seu dia.</Text>
        <Text style={styles.permissionCopy}>A câmera é o começo de tudo. Ela só abre quando você estiver usando o aplicativo.</Text>
        <Pressable style={styles.primaryButton} onPress={requestPermission}><Text style={styles.primaryButtonText}>Abrir a câmera</Text></Pressable>
      </SafeAreaView>
    );
  }

  // Sobe até a setinha do feed no topo, encolhendo e girando de leve.
  const rise = hole ? -(hole.y + hole.w / 2 - 40) : -screenHeight / 2;
  const photoStyle = {
    opacity: fly.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
    transform: [
      { translateY: fly.interpolate({ inputRange: [0, 1], outputRange: [0, rise] }) },
      { scale: fly.interpolate({ inputRange: [0, 0.12, 1], outputRange: [1, 1.04, 0.12] }) },
      { rotate: fly.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-10deg'] }) },
    ],
  };

  return (
    <View style={styles.cameraScreen} {...cameraSwipe.panHandlers}>
      <StatusBar style="light" />
      {/* A câmera vive dentro de um "cartão" do tamanho da forma, recortado nela; o resto da tela é o fundo preto.
          A virada 3D gira só esse cartão: girar a tela inteira fazia metade dela passar por cima dos botões.
          A câmera continua do tamanho da tela (deslocada dentro do cartão), então o enquadramento é o mesmo. */}
      {hole && (
        <Animated.View style={{
          position: 'absolute', left: hole.x, top: hole.y, width: hole.w, height: hole.w,
          transform: [
            { perspective: 900 },
            { rotateY: flip.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-90deg', '0deg', '90deg'], extrapolate: 'clamp' }) },
            { scale: flip.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.9, 1, 0.9], extrapolate: 'clamp' }) },
          ],
        }}>
          <MaskedView style={StyleSheet.absoluteFill} maskElement={<Svg width="100%" height="100%" viewBox={VIEWBOX}><Path d={shapePath(shape.id)} fill="#000000" /></Svg>}>
            <CameraView
              ref={cameraRef}
              style={{ position: 'absolute', left: -hole.x, top: -hole.y, width: screenWidth, height: screenHeight }}
              facing={facing}
              mirror={facing === 'front'}
              animateShutter={false}
              active={!feedFull}
              flash={flashOn && facing === 'back' ? 'on' : 'off'}
              selectedLens={selectedLens}
              onAvailableLensesChanged={updateAvailableLenses}
            />
          </MaskedView>
        </Animated.View>
      )}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flipCover, { opacity: flipCover }]} />
      {flying && hole && (
        // A foto original na mesma geometria da câmera (cobrindo a tela) e recortada no mesmo buraco:
        // aparece idêntica à imagem congelada e já pode voar sem esperar o recorte.
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, photoStyle, { transformOrigin: [hole.x + hole.w / 2, hole.y + hole.w / 2, 0] }]}>
          <MaskedView style={StyleSheet.absoluteFill} maskElement={<ShapeAt hole={hole} shape={shape.id} />}>
            <ExpoImage source={{ uri: flying }} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} onDisplay={launchFlight} />
          </MaskedView>
        </Animated.View>
      )}
      <SafeAreaView style={styles.cameraUi}>
          <View style={styles.feedChevronBox} pointerEvents="none">
            <Text style={styles.feedChevron}>⌄</Text>
            {hasNew && <View style={styles.newDot} />}
          </View>
          <View style={styles.guideArea}>
            <Pressable ref={guideRef} onLayout={measureHole} style={styles.guideBox} onPress={nextShape}>
            </Pressable>
            <View style={styles.hintRow}>
              <Text style={styles.cameraHint}>toque para mudar · {shape.label}</Text>
            </View>
          </View>
          <View style={styles.lensSelector}>
            {availableLenses.length > 1 && availableLenses.map((lens) => {
              const active = lens === selectedLens;
              return (
                <Pressable
                  key={lens}
                  accessibilityLabel={`Usar lente ${lensLabel(lens)}`}
                  style={[styles.lensButton, active && styles.lensButtonActive]}
                  onPress={() => {
                    setSelectedLens(lens);
                    void Haptics.selectionAsync();
                  }}
                >
                  <Text style={[styles.lensButtonText, active && styles.lensButtonTextActive]}>{lensLabel(lens)}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.cameraFooter}>
            <View style={styles.footerSide}>
              <Pressable
                accessibilityLabel={flashOn ? 'Desligar flash' : 'Ligar flash'}
                hitSlop={12}
                style={[styles.roundIcon, flashOn && styles.roundIconOn]}
                onPress={() => { setFlashOn((v) => !v); void Haptics.selectionAsync(); }}
              >
                <Icon d={flashOn ? ICONS.flash : ICONS.flashOff} size={24} color={flashOn ? COLORS.ink : COLORS.white} />
              </Pressable>
            </View>
            <Pressable
              accessibilityLabel="Tirar foto"
              onPressIn={() => Animated.spring(shutterPress, { toValue: 0.88, ...SPRING }).start()}
              onPressOut={() => Animated.spring(shutterPress, { toValue: 1, ...SPRING, damping: 10 }).start()}
              onPress={takePhoto}
              disabled={takingPhoto}
            >
              <Animated.View style={[styles.shutterOuter, { transform: [{ scale: shutterPress }] }]}>
                <View style={styles.shutterInner} />
              </Animated.View>
            </Pressable>
            <View style={styles.footerSide}>
              <Pressable accessibilityLabel="Inverter câmera" hitSlop={12} style={styles.roundIcon} onPress={toggleFacing}>
                <Animated.View style={{ transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
                  <Icon d={ICONS.flip} size={28} />
                </Animated.View>
              </Pressable>
            </View>
          </View>
          <View style={styles.undoRow}>
            <Animated.View style={{ opacity: undoPill, transform: [{ translateY: undoPill.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
              <Pressable style={styles.undoPill} hitSlop={10} onPress={undo} accessibilityLabel="Desfazer envio">
                <Icon d={ICONS.undo} size={15} />
                <Text style={styles.undoText}>Desfazer</Text>
              </Pressable>
            </Animated.View>
          </View>
      </SafeAreaView>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash }]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.toast, { opacity: toast, transform: [{ translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}
      >
        <Text style={styles.toastText}>✓  {toastText}</Text>
      </Animated.View>
      {(
        <Animated.View pointerEvents={showFeed ? 'auto' : 'none'} style={[styles.feedOverlay, { transform: [{ translateY: feedTranslateY }] }]}>
          <SafeAreaView style={styles.feedScreen} {...feedSwipe.panHandlers}>
            <View style={styles.feedTop}>
              <Pressable hitSlop={14} onPress={closeFeed} accessibilityLabel="Voltar para a câmera"><Icon d={ICONS.close} size={24} /></Pressable>
              {posts.length > 1 && <Text style={styles.feedCount}>{(index % posts.length) + 1} de {posts.length}</Text>}
            </View>
            {current && !allReady ? (
              <View style={styles.feedLoading}><ActivityIndicator color="#FFFFFF80" /></View>
            ) : current ? (
              <View style={styles.viewer}>
                <Pressable
                  style={[styles.deck, stickerDrag.active && styles.deckLifted]}
                  onPress={nextPost}
                  onLongPress={() => current.mine && confirmDeletePost(current)}
                  delayLongPress={450}
                >
                  {/* Cada foto tem seu cartão fixo (key = id) e todos ficam montados: a foto nunca é baixada de novo. */}
                  {posts
                    .map((post, i) => ({ post, depth: depthOf(i, index, posts.length) }))
                    .sort((a, b) => b.depth - a.depth)
                    .map(({ post, depth }) => (
                      <DeckCard
                        key={post.id}
                        pos={posFor(post.id, depth)}
                        uri={localUris.get(post.id) ?? API_URL + post.photoPath}
                        shape={post.shape}
                        message={depth === 0 ? post.message : null}
                        width={screenWidth}
                        postId={post.id}
                        placements={post.stickers ?? []}
                        box={screenWidth * 0.84}
                        editable={depth === 0}
                        actions={placementActions}
                      />
                    ))}
                </Pressable>
                <View style={styles.postMeta}>
                  <Text style={styles.senderName}>{current.mine ? 'Você' : current.senderName}</Text>
                  <Text style={styles.sentTime}>{timeAgo(current.createdAt)}</Text>
                  <ExpiryRing createdAt={current.createdAt} expiresAt={current.expiresAt} />
                </View>
                {current.mine ? (
                  <View style={styles.statusBox}>
                    {current.reaction && <ReactionGlyph value={current.reaction} stickers={stickers} size={48} />}
                    <Text style={styles.feedStatus}>{current.openedAt ? 'Vista' : 'Enviada'}</Text>
                  </View>
                ) : (
                  <View style={styles.reactions}>
                    {QUICK_REACTIONS.map((emoji, i) => (
                      <ReactionButton
                        key={emoji}
                        label={`Reagir com ${emoji}`}
                        style={QUICK_SPOTS[i]}
                        active={current.reaction === emoji}
                        dimmed={!!current.reaction && current.reaction !== emoji}
                        onPress={() => react(current, emoji)}
                      >
                        <Text style={styles.reactionEmoji}>{emoji}</Text>
                      </ReactionButton>
                    ))}
                    {/* "+": abre a aba; se a reação escolhida veio de lá, ela aparece no lugar do "+". */}
                    {(() => {
                      const custom = current.reaction && !QUICK_REACTIONS.includes(current.reaction) ? current.reaction : null;
                      return (
                        <ReactionButton label="Mais reações e stickers" style={PLUS_SPOT} active={!!custom} dimmed={!!current.reaction && !custom} onPress={() => setSheetOpen(true)}>
                          {custom ? <ReactionGlyph value={custom} stickers={stickers} size={34} /> : <Icon d={ICONS.plus} size={24} />}
                        </ReactionButton>
                      );
                    })()}
                    {burst && <Burst key={burst.id} value={burst.emoji} stickers={stickers} id={burst.id} />}
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.emptyFeed}>
                {me && !me.partner ? (
                  <>
                    <Text style={styles.emptyFeedLabel}>SEU CÓDIGO</Text>
                    <Text selectable style={styles.emptyFeedCode}>{me.code}</Text>
                    <Text style={styles.emptyFeedCopy}>Envie para a sua pessoa. Ao abrir o app, ela toca em “recebi um código”.</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.emptyFeedTitle}>Nada por aqui ainda</Text>
                    <Text style={styles.emptyFeedCopy}>Os momentos enviados aparecem aqui por 24 horas.</Text>
                  </>
                )}
              </View>
            )}
            <View style={styles.feedGrip}><View style={styles.dragHandle} /></View>
          </SafeAreaView>
          <TrashZone visible={stickerDrag.active} hot={stickerDrag.overTrash} />
          <ReactionSheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            onPick={(value) => { setSheetOpen(false); if (current) void react(current, value); }}
            onPlace={(sticker) => { setSheetOpen(false); if (current) placeSticker(current.id, sticker); }}
            stickers={stickers}
            onAddSticker={addSticker}
            onDeleteSticker={deleteSticker}
            adding={addingSticker}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cameraScreen: { flex: 1, backgroundColor: '#000000' }, // preto puro: aparece atrás da forma durante a virada 3D
  flash: { backgroundColor: COLORS.white },
  cameraUi: { flex: 1, paddingHorizontal: 22, paddingTop: Platform.OS === 'android' ? 38 : 8 },
  guideArea: { flex: 1, alignItems: 'center', justifyContent: 'center', marginHorizontal: -10 },
  guideBox: { width: '90%', maxHeight: '100%', aspectRatio: 1 },
  hintRow: { height: 20, marginTop: -6, alignSelf: 'stretch', alignItems: 'center' },
  cameraHint: { color: '#FFFFFFC9', fontSize: 12, letterSpacing: 0.3, textAlign: 'center' },
  feedChevronBox: { position: 'absolute', top: 0, alignSelf: 'center', alignItems: 'center', zIndex: 2 },
  newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.coral, marginTop: 2 },
  onboarding: { width: '100%', alignItems: 'center', gap: 14 },
  field: { width: '100%', maxWidth: 340, color: COLORS.text, fontSize: 18, textAlign: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#FFFFFF33' },
  linkText: { color: COLORS.muted, fontSize: 13, marginTop: 6 },
  feedChevron: { color: '#FFFFFFB8', fontSize: 26, lineHeight: 26, textAlign: 'center', zIndex: 2 },
  lensSelector: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0A0908A8', borderRadius: 28, padding: 5, minHeight: 53 },
  lensButton: { width: 43, height: 43, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  lensButtonActive: { backgroundColor: COLORS.white },
  lensButtonText: { color: '#FFFFFFB8', fontSize: 12, fontWeight: '700' },
  lensButtonTextActive: { color: COLORS.ink },
  cameraFooter: { height: 108, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18 },
  footerSide: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  roundIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF1F', alignItems: 'center', justifyContent: 'center' },
  shutterOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 3, borderColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
  // A foto cobre o desenho inteiro (0–300) e a caixa mostra 20–280: sobra 20/260 de cada lado.
  photoFill: { position: 'absolute', left: '-7.69%', top: '-7.69%', width: '115.38%', height: '115.38%' },
  softShade: { backgroundColor: '#00000059' },
  flipCover: { backgroundColor: '#000000' },
  roundIconOn: { backgroundColor: COLORS.white },
  feedLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  undoRow: { height: 44, alignItems: 'center', justifyContent: 'center' },
  undoPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF1F', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  undoText: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: COLORS.white },
  toast: { position: 'absolute', top: 64, alignSelf: 'center', backgroundColor: '#FFFFFFEE', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9 },
  toastText: { color: COLORS.ink, fontSize: 13, fontWeight: '700' },
  permissionScreen: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: 32, justifyContent: 'center', alignItems: 'center' },
  permissionMark: { width: 62, height: 62, borderRadius: 31, borderWidth: 1, borderColor: COLORS.coral, alignItems: 'center', justifyContent: 'center', marginBottom: 30 },
  permissionMarkText: { color: COLORS.coral, fontSize: 42, lineHeight: 48 },
  permissionEyebrow: { color: COLORS.coral, fontSize: 10, letterSpacing: 3, fontWeight: '800', marginBottom: 12 },
  permissionTitle: { color: COLORS.text, fontSize: 34, lineHeight: 40, fontWeight: '600', textAlign: 'center' },
  permissionCopy: { color: COLORS.muted, fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 18, marginBottom: 34, maxWidth: 340 },
  primaryButton: { backgroundColor: COLORS.coral, paddingVertical: 17, paddingHorizontal: 30, borderRadius: 16 },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  feedOverlay: { ...StyleSheet.absoluteFill, backgroundColor: '#000000', borderBottomLeftRadius: 38, borderBottomRightRadius: 38, overflow: 'hidden' },
  feedScreen: { flex: 1, backgroundColor: '#000000' },
  feedTop: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  feedCount: { color: '#FFFFFF66', fontSize: 13, fontWeight: '500', letterSpacing: -0.1 },
  viewer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 8 },
  deck: { width: '84%', aspectRatio: 1, marginBottom: 22 },
  deckLifted: { zIndex: 10 },
  postMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  senderName: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  sentTime: { color: '#FFFFFF66', fontSize: 15, letterSpacing: -0.2 },
  feedCaption: { position: 'absolute', left: '14%', right: '14%', bottom: '10%', backgroundColor: '#00000073', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9 },
  feedCaptionText: { color: '#FFFFFF', textAlign: 'center', fontSize: 16, lineHeight: 21, fontWeight: '500', letterSpacing: -0.2 },
  statusBox: { height: 152, alignItems: 'center', justifyContent: 'center', gap: 8 },
  statusEmoji: { fontSize: 40 },
  feedStatus: { color: '#FFFFFF66', fontSize: 13, letterSpacing: -0.1 },
  reactions: { width: 224, height: 152, marginTop: 26 },
  reactionSpot: { position: 'absolute' },
  reactionButton: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  reactionActive: { backgroundColor: '#3A3A3C' },
  reactionDimmed: { opacity: 0.4 },
  reactionEmoji: { fontSize: 28 },
  burst: { position: 'absolute', left: 0, right: 0, top: 50, alignItems: 'center' },
  sheetBackdrop: { backgroundColor: '#000000A6' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 460, backgroundColor: '#1C1C1E', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, paddingBottom: 28 },
  sheetGrip: { width: 36, height: 5, borderRadius: 3, backgroundColor: '#FFFFFF33', alignSelf: 'center', marginBottom: 12 },
  tabs: { flexDirection: 'row', alignSelf: 'center', backgroundColor: '#2C2C2E', borderRadius: 10, padding: 2, marginBottom: 10 },
  tab: { paddingHorizontal: 22, paddingVertical: 7, borderRadius: 8 },
  tabActive: { backgroundColor: '#48484A' },
  tabText: { color: '#FFFFFF99', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#FFFFFF' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 12 },
  gridCell: { width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  gridEmoji: { fontSize: 30 },
  trash: { position: 'absolute', alignSelf: 'center', bottom: TRASH_BOTTOM, width: TRASH_SIZE, height: TRASH_SIZE, borderRadius: TRASH_SIZE / 2, backgroundColor: '#2C2C2EEE', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  trashHot: { backgroundColor: COLORS.coral },
  addingText: { color: '#FFFFFF77', fontSize: 9, marginTop: 4 },
  stickerCell: { width: '25%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  addSticker: { width: 64, height: 64, borderRadius: 16, borderWidth: 1.5, borderColor: '#FFFFFF33', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  sheetHint: { color: '#FFFFFF55', fontSize: 12, textAlign: 'center', marginTop: 6 },
  feedGrip: { height: 30, alignItems: 'center', justifyContent: 'center' },
  dragHandle: { width: 36, height: 5, borderRadius: 3, backgroundColor: '#FFFFFF40' },
  emptyFeed: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyFeedLabel: { color: '#FFFFFF66', fontSize: 12, fontWeight: '600', letterSpacing: 1.5 },
  emptyFeedCode: { color: '#FFFFFF', fontSize: 44, fontWeight: '300', letterSpacing: 8, marginTop: 8 },
  emptyFeedTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '600', letterSpacing: -0.3 },
  emptyFeedCopy: { color: '#FFFFFF66', fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 10, maxWidth: 280 },
});
