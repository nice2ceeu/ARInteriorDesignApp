import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Text, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Rect } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { detectRoomObjects, type RoomDetectionResult } from '@/services/RoomDetectionService';
import { ApiError } from '@/services/apiClient';

export default function RoomDetectionCard({ onDetected }: { onDetected: (labels: string[]) => void }) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [result, setResult] = useState<RoomDetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = async (camera: boolean) => {
    setError(null);
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera permission', 'Allow camera access to photograph your room.');
          return;
        }
      } else if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Photo permission', 'Allow photo access to select your room image.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], base64: true, quality: 0.5 };
      const picked = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (picked.canceled) return;
      const asset = picked.assets[0];
      setPhotoUri(asset.uri);
      setResult(null);
      onDetected([]);
      if (!asset.base64) throw new Error('Could not read the selected image. Try a JPEG room photo.');
      if (asset.base64.length > 7_000_000) throw new Error('Choose a room photo smaller than 5 MB.');
      setBusy(true);
      const detections = await detectRoomObjects(asset.base64);
      setResult(detections);
      onDetected([...new Set(detections.detections.map(item => item.label))]);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError('Sign in to analyze a room photo.');
      } else if (caught instanceof ApiError && caught.status === 503) {
        setError('Room recognition is unavailable right now. You can still enter measurements and generate layouts.');
      } else {
        setError(caught instanceof Error ? caught.message : 'Room recognition is unavailable. You can still enter room measurements manually.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ margin: 16, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfacePrimary }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: colors.textPrimary }}>Identify room objects</Text>
      <Text style={{ color: colors.textSecondary, marginVertical: 8 }}>Use a room photo to identify furniture, doors and windows. Enter measured room dimensions below.</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {Platform.OS !== 'web' && <TouchableOpacity disabled={busy} onPress={() => analyze(true)}><Text style={{ color: colors.accent }}>Take photo</Text></TouchableOpacity>}
        <TouchableOpacity disabled={busy} onPress={() => analyze(false)}><Text style={{ color: colors.accent }}>Choose photo</Text></TouchableOpacity>
      </View>
      {busy && <ActivityIndicator style={{ marginTop: 12 }} color={colors.accent} />}
      {photoUri && result && (
        <View style={{ marginTop: 12, width: '100%', aspectRatio: result.imageWidth / result.imageHeight }}>
          <Image source={{ uri: photoUri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          <Svg style={{ position: 'absolute', inset: 0 }} width="100%" height="100%" viewBox={`0 0 ${result.imageWidth} ${result.imageHeight}`}>
            {result.detections.map((item, index) => <Rect key={index} {...item.boundingBox} fill="transparent" stroke="#22c55e" strokeWidth={Math.max(2, result.imageWidth / 300)} />)}
          </Svg>
        </View>
      )}
      {result && <Text style={{ color: colors.textPrimary, marginTop: 8 }}>{result.detections.length ? [...new Set(result.detections.map(item => item.label))].join(', ') : 'No objects were recognized. Try a clearer room photo.'}</Text>}
      {error && <Text style={{ color: colors.textSecondary, marginTop: 8 }}>{error}</Text>}
    </View>
  );
}
