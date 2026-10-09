import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  TextInput,
  TouchableOpacity,
  Text,
  Animated,
  Keyboard,
  FlatList,
  Platform,
  Alert,
} from 'react-native';
import { autocomplete } from '../services/s3Service';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (word: string) => void;
  placeholder?: string;
  isLoading?: boolean;
  disabled?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChangeText,
  onSubmit,
  placeholder = 'Search for a sign...',
  isLoading = false,
  disabled = false,
}) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const listenPulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for loading state
  useEffect(() => {
    if (isLoading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.7,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isLoading, pulseAnim]);

  // Pulse animation for listening state
  useEffect(() => {
    if (isListening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(listenPulseAnim, {
            toValue: 0.5,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(listenPulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      listenPulseAnim.setValue(1);
    }
  }, [isListening, listenPulseAnim]);

  // Update suggestions when value changes
  useEffect(() => {
    if (value.length >= 2) {
      const results = autocomplete(value, 5);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [value]);

  const resolveSpeechLocale = useCallback(async () => {
    const fallbackLocale = 'en-US';

    try {
      const localesResult = await ExpoSpeechRecognitionModule.getSupportedLocales({});
      const availableLocales = [
        ...(localesResult.installedLocales || []),
        ...(localesResult.locales || []),
      ];

      const preferredLocales = ['en-US', 'en-IN', 'en-GB'];
      const preferredMatch = preferredLocales.find((locale) => availableLocales.includes(locale));

      return preferredMatch || availableLocales[0] || fallbackLocale;
    } catch (error) {
      console.warn('Failed to fetch supported locales. Falling back to en-US.', error);
      return fallbackLocale;
    }
  }, []);

  const handleSpeechRecognition = useCallback(async () => {
    if (isListening) {
      // Stop listening
      try {
        ExpoSpeechRecognitionModule.stop();
        setIsListening(false);
      } catch (error) {
        console.log('Stop error:', error);
      }
      return;
    }

    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert(
          'Speech Recognition Unavailable',
          'Speech recognition is not available on this device right now.'
        );
        return;
      }

      // Check and request permissions
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permission Required',
          'Please grant microphone permission to use speech recognition.',
          [{ text: 'OK' }]
        );
        return;
      }

      const locale = await resolveSpeechLocale();
      console.log('Using locale:', locale);

      // Start listening
      setIsListening(true);
      Keyboard.dismiss();

      ExpoSpeechRecognitionModule.start({
        lang: locale || 'en-US',
        interimResults: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false,
        addsPunctuation: true,
        iosTaskHint: 'dictation',
      });
    } catch (error) {
      console.error('Speech recognition error:', error);
      setIsListening(false);
      Alert.alert('Error', 'Failed to start speech recognition. Please try again.');
    }
  }, [isListening, resolveSpeechLocale]);

  // Handle speech recognition results
  useEffect(() => {
    const subscription = ExpoSpeechRecognitionModule.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
      const transcript = event.results?.[0]?.transcript?.trim();
      if (!transcript) {
        return;
      }

      // Update input with transcribed text
      onChangeText(transcript);

      // If final result, submit automatically
      if (event.isFinal) {
        setIsListening(false);
        onSubmit(transcript);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [onChangeText, onSubmit]);

  // Handle speech recognition end
  useEffect(() => {
    const startSubscription = ExpoSpeechRecognitionModule.addListener('start', () => {
      setIsListening(true);
    });

    const endSubscription = ExpoSpeechRecognitionModule.addListener('end', () => {
      setIsListening(false);
    });

    return () => {
      startSubscription.remove();
      endSubscription.remove();
    };
  }, []);

  // Handle errors
  useEffect(() => {
    const errorSubscription = ExpoSpeechRecognitionModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
      setIsListening(false);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error('Speech error:', event.error, event.message);
        Alert.alert('Speech Error', event.message || `Error: ${event.error}`);
      } else {
        console.log('Speech recognition stopped:', event.error);
      }
    });

    return () => {
      errorSubscription.remove();
    };
  }, []);

  const handleSubmit = useCallback(() => {
    if (value.trim()) {
      Keyboard.dismiss();
      setShowSuggestions(false);
      onSubmit(value.trim());
    }
  }, [value, onSubmit]);

  const handleSuggestionPress = useCallback((word: string) => {
    onChangeText(word);
    Keyboard.dismiss();
    setShowSuggestions(false);
    onSubmit(word);
  }, [onChangeText, onSubmit]);

  const handleClear = useCallback(() => {
    onChangeText('');
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, [onChangeText]);

  const handleFocus = useCallback(() => {
    if (suggestions.length > 0) {
      setShowSuggestions(true);
    }
  }, [suggestions]);

  const handleBlur = useCallback(() => {
    // Delay hiding to allow suggestion press to register
    setTimeout(() => setShowSuggestions(false), 200);
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.inputContainer,
          disabled && styles.inputContainerDisabled,
          { opacity: disabled ? 0.6 : pulseAnim }
        ]}
      >
        {/* Search Icon */}
        <View style={styles.iconContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
        </View>

        {/* Text Input */}
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={handleSubmit}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          editable={!disabled && !isListening}
          selectTextOnFocus
        />

        {/* Listening indicator */}
        {isListening && (
          <Animated.View style={[styles.listeningIndicator, { opacity: listenPulseAnim }]}>
            <Text style={styles.listeningText}>🎤</Text>
          </Animated.View>
        )}

        {/* Clear Button */}
        {value.length > 0 && !isListening && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={handleClear}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.clearIcon}>✕</Text>
          </TouchableOpacity>
        )}

        {/* Microphone Button */}
        <TouchableOpacity
          style={[
            styles.micButton,
            isListening && styles.micButtonActive,
            disabled && styles.micButtonDisabled,
          ]}
          onPress={handleSpeechRecognition}
          disabled={disabled}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.micIcon, isListening && styles.micIconActive]}>
            {isListening ? '⏹️' : '🎤'}
          </Text>
        </TouchableOpacity>

        {/* Search Button - hide when listening */}
        {!isListening && (
          <TouchableOpacity
            style={[
              styles.searchButton,
              (!value.trim() || disabled) && styles.searchButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!value.trim() || disabled}
          >
            <Text style={styles.searchButtonText}>
              {isLoading ? '...' : 'Go'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Listening - Stop button */}
        {isListening && (
          <TouchableOpacity
            style={styles.stopListeningButton}
            onPress={handleSpeechRecognition}
          >
            <Text style={styles.stopListeningText}>Stop</Text>
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* Autocomplete Suggestions */}
      {showSuggestions && (
        <View style={styles.suggestionsContainer}>
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.suggestionItem}
                onPress={() => handleSuggestionPress(item)}
              >
                <Text style={styles.suggestionText}>{item}</Text>
              </TouchableOpacity>
            )}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    zIndex: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a4a',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 4,
    borderWidth: 1,
    borderColor: '#3a3a6a',
  },
  inputContainerDisabled: {
    backgroundColor: '#1a1a3a',
  },
  iconContainer: {
    marginRight: 8,
  },
  searchIcon: {
    fontSize: 18,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
    paddingVertical: Platform.OS === 'ios' ? 0 : 8,
  },
  clearButton: {
    padding: 4,
    marginRight: 8,
  },
  clearIcon: {
    color: '#888',
    fontSize: 16,
  },
  listeningIndicator: {
    marginRight: 8,
  },
  listeningText: {
    fontSize: 18,
  },
  micButton: {
    backgroundColor: '#3a3a6a',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    marginRight: 8,
  },
  micButtonActive: {
    backgroundColor: '#f44336',
  },
  micButtonDisabled: {
    backgroundColor: '#2a2a4a',
    opacity: 0.5,
  },
  micIcon: {
    fontSize: 18,
  },
  micIconActive: {
    fontSize: 18,
  },
  searchButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  searchButtonDisabled: {
    backgroundColor: '#2a4a2a',
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  stopListeningButton: {
    backgroundColor: '#f44336',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  stopListeningText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#2a2a4a',
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 200,
    borderWidth: 1,
    borderColor: '#3a3a6a',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  suggestionItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#3a3a6a',
  },
  suggestionText: {
    color: '#fff',
    fontSize: 15,
  },
});

export default SearchBar;
