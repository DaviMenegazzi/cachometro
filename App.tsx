import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';
import Svg, { ClipPath, Defs, Image as SvgImage, Path } from 'react-native-svg';

const COLORS = {
  ink: '#171614', cream: '#F5F0E8', coral: '#E76F51', muted: '#AAA39A', white: '#FFFDF8',
};

type ShapeName = 'heart' | 'star' | 'circle' | 'soft-square' | 'square';

const SHAPES: { id: ShapeName; label: string }[] = [
  { id: 'heart', label: 'coração' }, { id: 'star', label: 'estrela' },
  { id: 'circle', label: 'círculo' }, { id: 'soft-square', label: 'suave' },
  { id: 'square', label: 'quadrado' },
];

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
  const cameraRef = useRef<CameraView>(null);
  const bounce = useRef(new Animated.Value(1)).current;
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [shapeIndex, setShapeIndex] = useState(0);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [sending, setSending] = useState(false);
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

  const resetComposer = () => { setPhotoUri(null); setMessage(''); };

  const sendPhoto = async () => {
    setSending(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    setSending(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Pronta para enviar', 'A tela está funcionando. Na próxima etapa, este botão enviará a foto pela VPS e notificará a outra pessoa.', [{ text: 'Voltar para a câmera', onPress: resetComposer }]);
  };

  if (!permission) return <View style={styles.permissionScreen}><ActivityIndicator color={COLORS.coral} /></View>;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <StatusBar style="dark" />
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
        <StatusBar style="dark" />
        <KeyboardAvoidingView style={styles.composerInner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.composerHeader}>
            <Pressable hitSlop={14} onPress={resetComposer}><Text style={styles.headerAction}>Refazer</Text></Pressable>
            <Text style={styles.headerTitle}>PARA VOCÊ</Text>
            <Pressable hitSlop={14} onPress={savePhoto}><Text style={styles.headerAction}>Salvar</Text></Pressable>
          </View>
          <Pressable style={styles.previewPressable} onPress={animateShape}>
            <Animated.View style={[styles.preview, { transform: [{ scale: bounce }] }]}><ShapePreview uri={photoUri} shape={shape.id} /></Animated.View>
          </Pressable>
          <Text style={styles.shapeHint}>toque na foto para mudar · {shape.label}</Text>
          <View style={styles.messageBox}>
            <TextInput value={message} onChangeText={setMessage} placeholder="Escreva alguma coisa…" placeholderTextColor="#8D867D" multiline maxLength={240} style={styles.messageInput} />
            <Text style={styles.counter}>{message.length}/240</Text>
          </View>
          <Text style={styles.expiration}>Desaparece do feed em 24 horas</Text>
          <Pressable style={({ pressed }) => [styles.sendButton, pressed && styles.buttonPressed]} onPress={sendPhoto} disabled={sending}>
            {sending ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.sendButtonText}>Enviar foto  →</Text>}
          </Pressable>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraScreen}>
      <StatusBar style="light" />
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />
      <SafeAreaView style={styles.cameraUi}>
        <View style={styles.cameraHeader}>
          <View><Text style={styles.cameraEyebrow}>AGORA</Text><Text style={styles.cameraTitle}>Seu momento.</Text></View>
          <View style={styles.privatePill}><View style={styles.onlineDot} /><Text style={styles.privatePillText}>só vocês dois</Text></View>
        </View>
        <Pressable style={styles.guidePressable} onPress={animateShape}>
          <Animated.View style={[styles.guide, { transform: [{ scale: bounce }] }]}><CameraGuide shape={shape.id} /></Animated.View>
          <Text style={styles.cameraHint}>toque para mudar · {shape.label}</Text>
        </Pressable>
        <View style={styles.cameraFooter}>
          <View style={styles.footerSide} />
          <Pressable accessibilityLabel="Tirar foto" style={({ pressed }) => [styles.shutterOuter, pressed && styles.buttonPressed]} onPress={takePhoto} disabled={takingPhoto}><View style={styles.shutterInner} /></Pressable>
          <Pressable accessibilityLabel="Inverter câmera" style={styles.footerSide} onPress={() => setFacing((current) => (current === 'back' ? 'front' : 'back'))}><Text style={styles.flipIcon}>↻</Text></Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraScreen: { flex: 1, backgroundColor: COLORS.ink },
  cameraUi: { flex: 1, paddingHorizontal: 22, paddingTop: Platform.OS === 'android' ? 38 : 8 },
  cameraHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cameraEyebrow: { color: '#FFFFFFB5', fontSize: 10, letterSpacing: 2.6, fontWeight: '700' },
  cameraTitle: { color: COLORS.white, fontSize: 26, fontWeight: '600', marginTop: 3 },
  privatePill: { backgroundColor: '#16141199', borderWidth: 1, borderColor: '#FFFFFF26', borderRadius: 22, paddingHorizontal: 13, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 7 },
  privatePillText: { color: COLORS.white, fontSize: 12, fontWeight: '500' },
  onlineDot: { width: 6, height: 6, backgroundColor: '#9FCB91', borderRadius: 3 },
  guidePressable: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  guide: { width: '88%', aspectRatio: 1 },
  cameraHint: { color: '#FFFFFFC9', fontSize: 12, letterSpacing: 0.3, marginTop: -12 },
  cameraFooter: { height: 128, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18 },
  footerSide: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  flipIcon: { color: COLORS.white, fontSize: 29, fontWeight: '300' },
  shutterOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 3, borderColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: COLORS.white },
  buttonPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  permissionScreen: { flex: 1, backgroundColor: COLORS.cream, paddingHorizontal: 32, justifyContent: 'center', alignItems: 'center' },
  permissionMark: { width: 62, height: 62, borderRadius: 31, borderWidth: 1, borderColor: COLORS.coral, alignItems: 'center', justifyContent: 'center', marginBottom: 30 },
  permissionMarkText: { color: COLORS.coral, fontSize: 42, lineHeight: 48 },
  permissionEyebrow: { color: COLORS.coral, fontSize: 10, letterSpacing: 3, fontWeight: '800', marginBottom: 12 },
  permissionTitle: { color: COLORS.ink, fontSize: 34, lineHeight: 40, fontWeight: '600', textAlign: 'center' },
  permissionCopy: { color: '#625D56', fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 18, marginBottom: 34, maxWidth: 340 },
  primaryButton: { backgroundColor: COLORS.ink, paddingVertical: 17, paddingHorizontal: 30, borderRadius: 16 },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  composerScreen: { flex: 1, backgroundColor: COLORS.cream },
  composerInner: { flex: 1, paddingHorizontal: 22, paddingBottom: 14 },
  composerHeader: { height: 62, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerAction: { color: COLORS.coral, fontSize: 14, fontWeight: '600' },
  headerTitle: { color: COLORS.ink, fontSize: 10, letterSpacing: 2.6, fontWeight: '800' },
  previewPressable: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', maxWidth: 430, aspectRatio: 1 },
  shapeHint: { color: '#777067', fontSize: 12, textAlign: 'center', marginTop: -8, marginBottom: 14 },
  messageBox: { minHeight: 86, backgroundColor: COLORS.white, borderRadius: 18, borderWidth: 1, borderColor: '#E7DED2', padding: 15, marginBottom: 11 },
  messageInput: { color: COLORS.ink, fontSize: 16, lineHeight: 22, minHeight: 42, padding: 0, paddingRight: 40, textAlignVertical: 'top' },
  counter: { color: COLORS.muted, fontSize: 10, position: 'absolute', right: 14, bottom: 10 },
  expiration: { color: '#777067', fontSize: 11, textAlign: 'center', marginBottom: 11 },
  sendButton: { backgroundColor: COLORS.coral, height: 56, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sendButtonText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
