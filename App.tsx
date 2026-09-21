import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';
import Svg, { ClipPath, Defs, Image as SvgImage, Path } from 'react-native-svg';

const COLORS = {
  ink: '#160B0D', background: '#100709', surface: '#241014', text: '#FFF4F3',
  coral: '#E5484D', muted: '#B9A5A7', white: '#FFF9F8',
};

type ShapeName = 'heart' | 'star' | 'circle' | 'soft-square' | 'square';
type FeedPost = { uri: string; message: string; shape: ShapeName; sentAt: number };

const SHAPES: { id: ShapeName; label: string }[] = [
  { id: 'heart', label: 'coração' }, { id: 'star', label: 'estrela' },
  { id: 'circle', label: 'círculo' }, { id: 'soft-square', label: 'suave' },
  { id: 'square', label: 'quadrado' },
];

function lensLabel(lens: string) {
  if (lens.toLowerCase().includes('ultrawide')) return '0,5×';
  if (lens.toLowerCase().includes('telephoto')) return '2×';
  return '1×';
}

function shapePath(shape: ShapeName) {
  switch (shape) {
    case 'heart': return 'M150 274 C128 250 42 188 42 112 C42 55 112 33 150 82 C188 33 258 55 258 112 C258 188 172 250 150 274 Z';
    case 'star': return 'M150 22 L182 108 L274 112 L202 169 L226 258 L150 207 L74 258 L98 169 L26 112 L118 108 Z';
    case 'circle': return 'M150 24 A126 126 0 1 1 149.9 24 Z';
    case 'soft-square': return 'M62 28 H238 Q272 28 272 62 V238 Q272 272 238 272 H62 Q28 272 28 238 V62 Q28 28 62 28 Z';
    case 'square': return 'M28 28 H272 V272 H28 Z';
  }
}

function ShapePreview({ uri, shape }: { uri: string; shape: ShapeName }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 300 300">
      <Defs><ClipPath id="photo-mask"><Path d={shapePath(shape)} /></ClipPath></Defs>
      <SvgImage href={{ uri }} width="300" height="300" preserveAspectRatio="xMidYMid slice" clipPath="url(#photo-mask)" />
      <Path d={shapePath(shape)} fill="none" stroke={COLORS.white} strokeWidth="3" />
    </Svg>
  );
}

function CameraGuide({ shape }: { shape: ShapeName }) {
  return <Svg width="100%" height="100%" viewBox="0 0 300 300"><Path d={shapePath(shape)} fill="transparent" stroke={COLORS.white} strokeWidth="3" /></Svg>;
}

export default function App() {
  const { height: screenHeight } = useWindowDimensions();
  const cameraRef = useRef<CameraView>(null);
  const bounce = useRef(new Animated.Value(1)).current;
  const feedTranslateY = useRef(new Animated.Value(1000)).current;
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [availableLenses, setAvailableLenses] = useState<string[]>([]);
  const [selectedLens, setSelectedLens] = useState<string>();
  const [shapeIndex, setShapeIndex] = useState(0);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [captionEditing, setCaptionEditing] = useState(false);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedPost, setFeedPost] = useState<FeedPost | null>(null);
  const [showFeed, setShowFeed] = useState(false);
  const [reaction, setReaction] = useState<string | null>(null);
  const shape = SHAPES[shapeIndex];

  const animateShape = () => {
    void Haptics.selectionAsync();
    setShapeIndex((current) => (current + 1) % SHAPES.length);
    Animated.sequence([
      Animated.spring(bounce, { toValue: 0.9, useNativeDriver: true, speed: 35 }),
      Animated.spring(bounce, { toValue: 1.06, useNativeDriver: true, speed: 18 }),
      Animated.spring(bounce, { toValue: 1, useNativeDriver: true, speed: 18 }),
    ]).start();
  };

  const takePhoto = async () => {
    if (!cameraRef.current || takingPhoto) return;
    try {
      setTakingPhoto(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.82 });
      if (photo?.uri) setPhotoUri(photo.uri);
    } catch {
      Alert.alert('Não deu para fotografar', 'Tente novamente em alguns instantes.');
    } finally { setTakingPhoto(false); }
  };

  const savePhoto = async () => {
    if (!photoUri) return;
    const response = await MediaLibrary.requestPermissionsAsync();
    if (!response.granted) {
      Alert.alert('Acesso necessário', 'Permita o acesso às fotos para salvar esta imagem.');
      return;
    }
    await MediaLibrary.saveToLibraryAsync(photoUri);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Salva', 'A foto original foi guardada na sua galeria.');
  };

  const resetComposer = () => { setPhotoUri(null); setMessage(''); setCaptionEditing(false); };

  const startCaption = () => {
    setCaptionEditing(true);
    void Haptics.selectionAsync();
  };

  const updateAvailableLenses = ({ lenses }: { lenses: string[] }) => {
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

  const toggleFacing = () => {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
    setAvailableLenses([]);
    setSelectedLens(undefined);
  };

  const openFeed = () => {
    setShowFeed(true);
    feedTranslateY.setValue(-screenHeight);
    requestAnimationFrame(() => {
      Animated.spring(feedTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 180,
        mass: 0.9,
      }).start();
    });
  };

  const closeFeed = () => {
    Animated.timing(feedTranslateY, {
      toValue: -screenHeight,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setShowFeed(false);
      feedTranslateY.setValue(-screenHeight);
    });
  };

  const cameraSwipe = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      setShowFeed(true);
      feedTranslateY.setValue(-screenHeight);
    },
    onPanResponderMove: (_, gesture) => {
      feedTranslateY.setValue(Math.min(0, -screenHeight + Math.max(0, gesture.dy) * 3.6));
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 70 || gesture.vy > 0.65) {
        Animated.spring(feedTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 22,
          stiffness: 180,
          mass: 0.9,
        }).start();
      } else {
        closeFeed();
      }
    },
  });

  const feedSwipe = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy < -14 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_, gesture) => {
      feedTranslateY.setValue(Math.min(0, gesture.dy * 0.72));
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy < -65 || gesture.vy < -0.65) closeFeed();
      else Animated.spring(feedTranslateY, { toValue: 0, useNativeDriver: true }).start();
    },
  });

  const sendPhoto = async () => {
    if (!photoUri) return;
    setSending(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    setFeedPost({ uri: photoUri, message: message.trim(), shape: shape.id, sentAt: Date.now() });
    setPhotoUri(null);
    setMessage('');
    setCaptionEditing(false);
    setSending(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    openFeed();
  };

  if (!permission) return <View style={styles.permissionScreen}><ActivityIndicator color={COLORS.coral} /></View>;

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

  if (photoUri) {
    return (
      <SafeAreaView style={styles.composerScreen}>
        <StatusBar style="light" />
        <KeyboardAvoidingView style={styles.composerInner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.composerHeader}>
            <Pressable hitSlop={14} onPress={resetComposer}><Text style={styles.headerAction}>Refazer</Text></Pressable>
            <Text style={styles.headerTitle}>PARA VOCÊ</Text>
            <Pressable hitSlop={14} onPress={savePhoto}><Text style={styles.headerAction}>Salvar</Text></Pressable>
          </View>
          <Pressable style={styles.previewPressable} onPress={startCaption}>
            <Animated.View style={[styles.preview, { transform: [{ scale: bounce }] }]}>
              <ShapePreview uri={photoUri} shape={shape.id} />
              {captionEditing ? (
                <View style={styles.captionEditor}>
                  <TextInput
                    autoFocus
                    value={message}
                    onChangeText={setMessage}
                    onBlur={() => setCaptionEditing(false)}
                    placeholder="Escreva aqui…"
                    placeholderTextColor="#C9C3BA"
                    selectionColor={COLORS.coral}
                    multiline
                    maxLength={240}
                    style={styles.captionInput}
                  />
                  <Text style={styles.captionCounter}>{message.length}/240</Text>
                </View>
              ) : message ? (
                <View style={styles.captionDisplay}>
                  <Text style={styles.captionText}>{message}</Text>
                </View>
              ) : null}
            </Animated.View>
          </Pressable>
          <Text style={styles.captionHint}>{message ? 'toque na legenda para editar' : 'toque na foto para escrever'}</Text>
          <Text style={styles.expiration}>Desaparece do feed em 24 horas</Text>
          <Pressable style={({ pressed }) => [styles.sendButton, pressed && styles.buttonPressed]} onPress={sendPhoto} disabled={sending}>
            {sending ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.sendButtonText}>Enviar foto  →</Text>}
          </Pressable>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraScreen} {...cameraSwipe.panHandlers}>
      <StatusBar style="light" />
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        active={!showFeed}
        selectedLens={selectedLens}
        onAvailableLensesChanged={updateAvailableLenses}
      />
      <SafeAreaView style={styles.cameraUi}>
        <Pressable style={styles.guidePressable} onPress={animateShape}>
          <Animated.View style={[styles.guide, { transform: [{ scale: bounce }] }]}><CameraGuide shape={shape.id} /></Animated.View>
          <Text style={styles.cameraHint}>toque para mudar · {shape.label}</Text>
        </Pressable>
        <Text style={styles.feedChevron}>⌄</Text>
        {availableLenses.length > 1 && (
          <View style={styles.lensSelector}>
            {availableLenses.map((lens) => {
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
        )}
        <View style={styles.cameraFooter}>
          <View style={styles.footerSide} />
          <Pressable accessibilityLabel="Tirar foto" style={({ pressed }) => [styles.shutterOuter, pressed && styles.buttonPressed]} onPress={takePhoto} disabled={takingPhoto}><View style={styles.shutterInner} /></Pressable>
          <Pressable accessibilityLabel="Inverter câmera" style={styles.footerSide} onPress={toggleFacing}><Text style={styles.flipIcon}>↻</Text></Pressable>
        </View>
      </SafeAreaView>
      {showFeed && (
        <Animated.View
          style={[styles.feedOverlay, { transform: [{ translateY: feedTranslateY }] }]}
          {...feedSwipe.panHandlers}
        >
          <SafeAreaView style={styles.feedScreen}>
            <View style={styles.dragHandle} />

            {feedPost ? <View style={styles.feedCard}>
              <View style={styles.feedMeta}>
                <View style={styles.avatar}><Text style={styles.avatarText}>V</Text></View>
                <View style={styles.feedMetaText}>
                  <Text style={styles.senderName}>Você</Text>
                  <Text style={styles.sentTime}>enviado agora</Text>
                </View>
                <View style={styles.expiryPill}><Text style={styles.expiryPillText}>23h 59min</Text></View>
              </View>

              <View style={styles.feedPhoto}>
                <ShapePreview uri={feedPost.uri} shape={feedPost.shape} />
                {!!feedPost.message && (
                  <View style={styles.feedCaption}>
                    <Text style={styles.feedCaptionText}>{feedPost.message}</Text>
                  </View>
                )}
              </View>

              <View style={styles.feedStatusRow}>
                <Text style={styles.unreadDot}>●</Text>
                <Text style={styles.feedStatus}>Ainda não abriu</Text>
              </View>
              <View style={styles.reactionsRow}>
                {['🫶', '😍', '🥹', '❤️'].map((emoji) => (
                  <Pressable
                    key={emoji}
                    style={[styles.reactionButton, reaction === emoji && styles.reactionButtonActive]}
                    onPress={() => {
                      setReaction((current) => current === emoji ? null : emoji);
                      void Haptics.selectionAsync();
                    }}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
            </View> : (
              <View style={styles.emptyFeed}>
                <Text style={styles.emptyFeedMark}>◌</Text>
                <Text style={styles.emptyFeedTitle}>Ainda não tem nada aqui.</Text>
                <Text style={styles.emptyFeedCopy}>Volte para a câmera e envie o primeiro momento.</Text>
              </View>
            )}
            <Text style={styles.feedFootnote}>puxe para cima para voltar à câmera</Text>
          </SafeAreaView>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cameraScreen: { flex: 1, backgroundColor: COLORS.ink },
  cameraUi: { flex: 1, paddingHorizontal: 22, paddingTop: Platform.OS === 'android' ? 38 : 8 },
  guidePressable: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  guide: { width: '88%', aspectRatio: 1 },
  cameraHint: { color: '#FFFFFFC9', fontSize: 12, letterSpacing: 0.3, marginTop: -12 },
  feedChevron: { position: 'absolute', top: 8, alignSelf: 'center', color: '#FFFFFFB8', fontSize: 26, lineHeight: 26, textAlign: 'center', zIndex: 2 },
  lensSelector: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0A0908A8', borderRadius: 28, padding: 5 },
  lensButton: { width: 43, height: 43, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  lensButtonActive: { backgroundColor: COLORS.white },
  lensButtonText: { color: '#FFFFFFB8', fontSize: 12, fontWeight: '700' },
  lensButtonTextActive: { color: COLORS.ink },
  cameraFooter: { height: 108, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18 },
  footerSide: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  flipIcon: { color: COLORS.white, fontSize: 29, fontWeight: '300' },
  shutterOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 3, borderColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: COLORS.white },
  buttonPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  permissionScreen: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: 32, justifyContent: 'center', alignItems: 'center' },
  permissionMark: { width: 62, height: 62, borderRadius: 31, borderWidth: 1, borderColor: COLORS.coral, alignItems: 'center', justifyContent: 'center', marginBottom: 30 },
  permissionMarkText: { color: COLORS.coral, fontSize: 42, lineHeight: 48 },
  permissionEyebrow: { color: COLORS.coral, fontSize: 10, letterSpacing: 3, fontWeight: '800', marginBottom: 12 },
  permissionTitle: { color: COLORS.text, fontSize: 34, lineHeight: 40, fontWeight: '600', textAlign: 'center' },
  permissionCopy: { color: COLORS.muted, fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 18, marginBottom: 34, maxWidth: 340 },
  primaryButton: { backgroundColor: COLORS.coral, paddingVertical: 17, paddingHorizontal: 30, borderRadius: 16 },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  composerScreen: { flex: 1, backgroundColor: COLORS.background },
  composerInner: { flex: 1, paddingHorizontal: 22, paddingBottom: 14 },
  composerHeader: { height: 62, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerAction: { color: COLORS.coral, fontSize: 14, fontWeight: '600' },
  headerTitle: { color: COLORS.text, fontSize: 10, letterSpacing: 2.6, fontWeight: '800' },
  previewPressable: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', maxWidth: 430, aspectRatio: 1 },
  captionEditor: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#100C0DBD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: '16%' },
  captionInput: { width: '100%', color: COLORS.white, fontSize: 20, lineHeight: 27, fontWeight: '600', textAlign: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#FFFFFF5C', maxHeight: 122 },
  captionCounter: { color: '#FFFFFF70', fontSize: 10, marginTop: 8 },
  captionDisplay: { position: 'absolute', left: '15%', right: '15%', top: '39%', minHeight: 58, justifyContent: 'center', backgroundColor: '#10090A9C', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9 },
  captionText: { color: COLORS.white, fontSize: 17, lineHeight: 23, fontWeight: '600', textAlign: 'center' },
  captionHint: { color: '#8F8A82', fontSize: 12, textAlign: 'center', marginTop: -8, marginBottom: 12 },
  expiration: { color: '#77736D', fontSize: 11, textAlign: 'center', marginBottom: 11 },
  sendButton: { backgroundColor: COLORS.coral, height: 56, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sendButtonText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  feedOverlay: { ...StyleSheet.absoluteFill, backgroundColor: COLORS.background, borderBottomLeftRadius: 34, borderBottomRightRadius: 34, overflow: 'hidden', shadowColor: '#000000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.45, shadowRadius: 24, elevation: 24 },
  feedScreen: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: 20 },
  dragHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF42', alignSelf: 'center', marginTop: 8 },
  feedCard: { backgroundColor: COLORS.surface, borderRadius: 28, borderWidth: 1, borderColor: '#E5484D24', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 16, marginTop: 24 },
  feedMeta: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2, marginBottom: 8 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.coral, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.white, fontSize: 14, fontWeight: '800' },
  feedMetaText: { flex: 1, marginLeft: 10 },
  senderName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  sentTime: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  expiryPill: { backgroundColor: '#E5484D1F', borderRadius: 15, paddingHorizontal: 10, paddingVertical: 7 },
  expiryPillText: { color: '#F18A8D', fontSize: 10, fontWeight: '700' },
  feedPhoto: { width: '100%', aspectRatio: 1, position: 'relative' },
  feedCaption: { position: 'absolute', left: '15%', right: '15%', top: '40%', minHeight: 52, backgroundColor: '#10090AA6', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9, justifyContent: 'center' },
  feedCaptionText: { color: COLORS.white, textAlign: 'center', fontSize: 17, lineHeight: 23, fontWeight: '600' },
  feedStatusRow: { height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  unreadDot: { color: COLORS.coral, fontSize: 8 },
  feedStatus: { color: COLORS.muted, fontSize: 11, fontWeight: '600' },
  reactionsRow: { flexDirection: 'row', justifyContent: 'center', gap: 9, marginTop: 4 },
  reactionButton: { width: 46, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF0B', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF0F' },
  reactionButtonActive: { backgroundColor: '#E5484D30', borderColor: '#E5484D8A' },
  reactionEmoji: { fontSize: 20 },
  feedFootnote: { color: '#806F72', fontSize: 10, textAlign: 'center', marginTop: 16 },
  emptyFeed: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 90 },
  emptyFeedMark: { color: COLORS.coral, fontSize: 52, lineHeight: 58, marginBottom: 15 },
  emptyFeedTitle: { color: COLORS.text, fontSize: 21, fontWeight: '700', textAlign: 'center' },
  emptyFeedCopy: { color: COLORS.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, maxWidth: 260 },
});
