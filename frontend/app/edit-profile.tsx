import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, TextInput, ActivityIndicator, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_USER_STORAGE_KEY } from '@/data/authData';
import * as FileSystem from 'expo-file-system/legacy';
import { callApi } from '@/services/apiClient';
import { colors, radii, shadows, spacing } from '@/components/ui/theme';
import { AppText } from '@/components/ui/Text';
import { BackIcon, CameraIcon } from '@/components/ui/Icons';
import { launchImageLibrary, launchCamera, requestMediaLibraryPermissions, requestCameraPermissions } from '@/utils/imagePicker';

export default function EditProfileScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadUserData = async () => {
      try {
        const userData = await AsyncStorage.getItem(AUTH_USER_STORAGE_KEY);
        if (userData) {
          const user = JSON.parse(userData);
          setName(user.name || '');
          setEmail(user.email || '');
          setProfilePicture(user.profilePicture || null);
        }
      } catch (error) {
        console.warn('[EditProfile] Failed to load user data:', error);
      }
    };
    loadUserData();
  }, []);

  const requestPermissions = async () => {
    const hasPermission = await requestMediaLibraryPermissions();
    if (!hasPermission) {
      Alert.alert(
        'Permission Required',
        'We need access to your photos to set a profile picture.',
        [{ text: 'OK' }]
      );
      return false;
    }
    return true;
  };

  const convertImageToBase64 = async (uri: string): Promise<string> => {
    try {
      // Use expo-file-system to read the image file as base64
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      // Determine MIME type from file extension or default to jpeg
      const mimeType = uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      console.error('[EditProfile] Error converting image to base64:', error);
      throw error;
    }
  };

  const pickImage = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      const result = await launchImageLibrary({
        mediaTypes: 'images',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const uri = result.assets[0].uri;
        setProfilePicture(uri); // Show preview immediately
        // Convert to base64 in background (will be used when saving)
      }
    } catch (error) {
      console.error('[EditProfile] Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const takePhoto = async () => {
    const hasPermission = await requestCameraPermissions();
    if (!hasPermission) {
      Alert.alert(
        'Permission Required',
        'We need access to your camera to take a photo.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      const result = await launchCamera({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const uri = result.assets[0].uri;
        setProfilePicture(uri); // Show preview immediately
      }
    } catch (error) {
      console.error('[EditProfile] Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const showImagePickerOptions = () => {
    Alert.alert(
      'Change Profile Picture',
      'Choose an option',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Take Photo', onPress: takePhoto },
        { text: 'Choose from Library', onPress: pickImage },
        ...(profilePicture ? [{ text: 'Remove Photo', style: 'destructive', onPress: () => setProfilePicture(null) }] : []),
      ]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter your name.');
      return;
    }

    setSaving(true);
    try {
      const userData = await AsyncStorage.getItem(AUTH_USER_STORAGE_KEY);
      if (!userData) {
        Alert.alert('Error', 'User data not found. Please login again.');
        return;
      }

      const user = JSON.parse(userData);
      const userId = user.id;

      if (!userId) {
        Alert.alert('Error', 'User ID not found. Please login again.');
        return;
      }

      // Convert profile picture to base64 if it's a local URI
      let profilePictureBase64: string | null = null;
      if (profilePicture) {
        // Check if it's already a base64 data URL (from database or web picker)
        if (profilePicture.startsWith('data:image/')) {
          profilePictureBase64 = profilePicture;
        } else if (Platform.OS === 'web') {
          // On web, if it's not a data URL, it might be a blob URL - try to convert it
          // For web, the image picker should already return a data URL
          profilePictureBase64 = profilePicture;
        } else {
          // Convert local URI to base64 (native platforms)
          try {
            profilePictureBase64 = await convertImageToBase64(profilePicture);
          } catch (error) {
            console.error('[EditProfile] Failed to convert image:', error);
            Alert.alert('Error', 'Failed to process image. Please try again.');
            setSaving(false);
            return;
          }
        }
      }

      // Update user in database
      try {
        const response = await callApi<{ success: boolean; data: { user: any } }>(
          `/users/${userId}`,
          {
            method: 'PUT',
            body: {
              name: name.trim(),
              profilePicture: profilePictureBase64,
            },
          }
        );

        if (response.success && response.data?.user) {
          // Update local storage with response from backend
          const updatedUser = {
            ...user,
            name: response.data.user.name || name.trim(),
            email: response.data.user.email || user.email,
            profilePicture: response.data.user.profilePicture || profilePictureBase64,
          };
          await AsyncStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(updatedUser));
          
          Alert.alert('Success', 'Profile updated successfully!', [
            { text: 'OK', onPress: () => router.back() }
          ]);
        } else {
          throw new Error('Update failed');
        }
      } catch (apiError: any) {
        console.error('[EditProfile] API error:', apiError);
        // Fallback to local storage if API fails
        const updatedUser = {
          ...user,
          name: name.trim(),
          email: email.trim() || user.email,
          profilePicture: profilePictureBase64,
        };
        await AsyncStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(updatedUser));
        Alert.alert(
          'Warning',
          'Profile saved locally. Could not sync with server. Please check your connection.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      }
    } catch (error) {
      console.error('[EditProfile] Failed to save profile:', error);
      Alert.alert('Error', 'Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <BackIcon size={20} color={colors.accent} />
          <AppText variant="subtitle" color="accent" style={styles.backButtonText}>
            Back
          </AppText>
        </TouchableOpacity>
        <AppText variant="h3" color="textPrimary" style={styles.title}>
          Edit Profile
        </AppText>
        <View style={styles.placeholder} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Profile Picture Section */}
        <View style={styles.profilePictureSection}>
          <TouchableOpacity 
            style={styles.avatarContainer}
            onPress={showImagePickerOptions}
            activeOpacity={0.8}
          >
            {profilePicture ? (
              <Image 
                source={{ uri: profilePicture }} 
                style={styles.avatarImage}
              />
            ) : (
              <View style={styles.avatar}>
                <AppText variant="h2" color="surfacePrimary" style={styles.avatarText}>
                  {name 
                    ? name
                        .split(' ')
                        .map(n => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)
                    : 'U'}
                </AppText>
              </View>
            )}
            <View style={styles.cameraIcon}>
              <CameraIcon size={20} color={colors.surfacePrimary} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={showImagePickerOptions} style={styles.changePhotoButton}>
            <AppText variant="label" color="accent" style={styles.changePhotoText}>
              Change Photo
            </AppText>
          </TouchableOpacity>
        </View>

        {/* Form Section */}
        <View style={styles.formSection}>
          <View style={styles.inputGroup}>
            <AppText variant="label" color="textPrimary" style={styles.label}>
              Name
            </AppText>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Enter your name"
              placeholderTextColor="#999"
            />
          </View>

          <View style={styles.inputGroup}>
            <AppText variant="label" color="textPrimary" style={styles.label}>
              Email
            </AppText>
            <TextInput
              style={[styles.input, styles.inputDisabled]}
              value={email}
              editable={false}
              placeholder="Email cannot be changed"
              placeholderTextColor="#999"
            />
            <AppText variant="caption" color="textMuted" style={styles.helperText}>
              Email cannot be modified
            </AppText>
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity 
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <AppText variant="subtitle" color="surfacePrimary" style={styles.saveButtonText}>
              Save Changes
            </AppText>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: Platform.OS === 'ios' ? spacing.xxxl : spacing.xxl,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surfacePrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backButtonText: {
    fontSize: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  placeholder: {
    width: 60,
  },
  scrollContent: {
    padding: spacing.xl,
  },
  profilePictureSection: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
    paddingVertical: spacing.lg,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: spacing.md,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lg,
  },
  avatarImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    ...shadows.lg,
  },
  avatarText: {
    fontSize: 48,
    fontWeight: '700',
  },
  cameraIcon: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.surfacePrimary,
  },
  changePhotoButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  changePhotoText: {
    fontSize: 14,
  },
  formSection: {
    backgroundColor: colors.surfacePrimary,
    borderRadius: radii.lg,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  inputGroup: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surfacePrimary,
  },
  inputDisabled: {
    backgroundColor: colors.surfaceSecondary,
    color: colors.textMuted,
  },
  helperText: {
    fontSize: 12,
    marginTop: spacing.xs,
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    ...shadows.lg,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
