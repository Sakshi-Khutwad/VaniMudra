import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  FlatList,
  Dimensions,
  Platform,
  Switch,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AvatarWebView, { AvatarWebViewRef } from '../components/AvatarWebView';
import SearchBar from '../components/SearchBar';
import { lookupWord, getWordCount } from '../services/s3Service';
import CameraTranslateScreen from './CameraTranslateScreen';
import { processSentence, ApiError } from '../services/apiService';
import type { PlaybackStatus, HistoryItem, SignQueueItem, ProcessingMode } from '../types';

const HISTORY_STORAGE_KEY = '@signvision_history';
const MAX_HISTORY_ITEMS = 20;

const HomeScreen: React.FC = () => {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentWord, setCurrentWord] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAvatarReady, setIsAvatarReady] = useState(false);
  const [searchHistory, setSearchHistory] = useState<HistoryItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Sentence processing state
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('word');
  const [signQueue, setSignQueue] = useState<SignQueueItem[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [glossTokens, setGlossTokens] = useState<string[]>([]);

  const avatarRef = useRef<AvatarWebViewRef>(null);

  // Refs to access current values in callbacks without stale closures
  const signQueueRef = useRef<SignQueueItem[]>([]);
  const currentQueueIndexRef = useRef(0);
  const processingModeRef = useRef<ProcessingMode>('word');

  // Keep refs in sync with state
  useEffect(() => { signQueueRef.current = signQueue; }, [signQueue]);
  useEffect(() => { currentQueueIndexRef.current = currentQueueIndex; }, [currentQueueIndex]);
  useEffect(() => { processingModeRef.current = processingMode; }, [processingMode]);

  useEffect(() => {
    loadHistory();
  }, []);

  // Handle sign queue playback
  useEffect(() => {
    if (signQueue.length > 0 && currentQueueIndex < signQueue.length && playbackStatus === 'idle' && isAvatarReady) {
      const nextSign = signQueue[currentQueueIndex];
      setCurrentWord(nextSign.word);
      setPlaybackStatus('loading');
      avatarRef.current?.play(nextSign.url, nextSign.word);
    }
  }, [signQueue, currentQueueIndex, playbackStatus, isAvatarReady]);

  const loadHistory = async () => {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_STORAGE_KEY);
      if (stored) {
        setSearchHistory(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  };

  const saveToHistory = async (word: string, found: boolean) => {
    try {
      const newItem: HistoryItem = { word, timestamp: Date.now(), found };
      const filtered = searchHistory.filter(h => h.word !== word);
      const updated = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
      setSearchHistory(updated);
      await AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to save history:', error);
    }
  };

  const resetPlaybackState = () => {
    setSignQueue([]);
    setCurrentQueueIndex(0);
    setGlossTokens([]);
    setErrorMessage(null);
    setSuggestions([]);
  };

  const handleSearch = useCallback(async (input: string) => {
    if (!input.trim()) return;

    resetPlaybackState();

    if (processingMode === 'sentence') {
      // Sentence mode: Use backend API
      setIsProcessing(true);
      setPlaybackStatus('loading');

      try {
        const response = await processSentence(input);

        if (!response.success || response.results.length === 0) {
          setPlaybackStatus('error');
          setErrorMessage(response.error || 'Failed to process sentence');
          saveToHistory(input, false);
          setIsProcessing(false);
          return;
        }

        // Extract gloss tokens and build sign queue
        const result = response.results[0];
        setGlossTokens(result.gloss.gloss);

        // Build queue from signs that were found
        const queue: SignQueueItem[] = result.signs
          .filter(sign => sign.found && sign.s3_url)
          .map(sign => ({
            word: sign.word,
            url: sign.s3_url!,
            matchType: sign.match_type,
          }));

        if (queue.length === 0) {
          setPlaybackStatus('error');
          setErrorMessage('No signs found for this sentence');
          // Show similar words from first unfound sign
          const unfound = result.signs.find(s => !s.found);
          if (unfound?.similar_words) {
            setSuggestions(unfound.similar_words);
          }
          saveToHistory(input, false);
        } else {
          setSignQueue(queue);
          setCurrentQueueIndex(0);
          setPlaybackStatus('idle'); // Will trigger queue playback via useEffect
          saveToHistory(input, true);
        }
      } catch (error) {
        setPlaybackStatus('error');
        if (error instanceof ApiError) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage('Failed to connect to backend');
        }
        saveToHistory(input, false);
      } finally {
        setIsProcessing(false);
      }
    } else {
      // Word mode: Use local lookup (existing behavior)
      setPlaybackStatus('loading');

      const result = lookupWord(input);

      if (result.found && result.url) {
        setCurrentWord(result.word);
        saveToHistory(result.word, true);
        avatarRef.current?.play(result.url, result.word);
      } else {
        setPlaybackStatus('error');
        setErrorMessage(`"${input}" not found`);
        setSuggestions(result.suggestions || []);
        saveToHistory(input, false);
      }
    }
  }, [searchHistory, processingMode]);

  const handleAvatarReady = useCallback(() => {
    setIsAvatarReady(true);
    setPlaybackStatus('idle');
  }, []);

  const handlePlaying = useCallback((word: string) => {
    console.log('[HomeScreen] handlePlaying:', word);
    setPlaybackStatus('playing');
    setCurrentWord(word);
  }, []);

  const handleFinished = useCallback((word: string) => {
    const queue = signQueueRef.current;
    const currentIndex = currentQueueIndexRef.current;
    const mode = processingModeRef.current;

    console.log('[HomeScreen] handleFinished:', word, 'queue:', queue.length, 'index:', currentIndex, 'mode:', mode);

    if (mode === 'sentence' && queue.length > 0) {
      const nextIndex = currentIndex + 1;
      console.log('[HomeScreen] Next index:', nextIndex, 'Queue length:', queue.length);
      if (nextIndex < queue.length) {
        console.log('[HomeScreen] Playing next sign:', queue[nextIndex].word);
        setCurrentQueueIndex(nextIndex);
        setPlaybackStatus('idle');
      } else {
        console.log('[HomeScreen] Queue finished');
        setPlaybackStatus('finished');
        setSignQueue([]);
        setCurrentQueueIndex(0);
      }
    } else {
      setPlaybackStatus('finished');
    }
  }, []);

  const handleError = useCallback((message: string) => {
    setPlaybackStatus('error');
    setErrorMessage(message);
  }, []);

  const handleStatusChange = useCallback((status: string) => {
    console.log('[HomeScreen] CWASA raw status:', status);
  }, []);

  const handleStop = useCallback(() => {
    avatarRef.current?.stop();
    setSignQueue([]);
    setCurrentQueueIndex(0);
    setPlaybackStatus('idle');
  }, []);

  const handleHistoryPress = useCallback((item: HistoryItem) => {
    setSearchQuery(item.word);
    handleSearch(item.word);
  }, [handleSearch]);

  const handleSuggestionPress = useCallback((word: string) => {
    setSearchQuery(word);
    // For suggestions, always use word mode since they're single words
    const prevMode = processingMode;
    setProcessingMode('word');
    handleSearch(word);
    setProcessingMode(prevMode);
  }, [handleSearch, processingMode]);

  const clearHistory = async () => {
    try {
      await AsyncStorage.removeItem(HISTORY_STORAGE_KEY);
      setSearchHistory([]);
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  };

  const toggleMode = () => {
    setProcessingMode(prev => prev === 'word' ? 'sentence' : 'word');
    resetPlaybackState();
  };

  const getStatusText = () => {
    if (isProcessing) {
      return 'Processing sentence...';
    }

    if (processingMode === 'sentence' && signQueue.length > 0) {
      return `Playing ${currentQueueIndex + 1}/${signQueue.length}: ${currentWord}`;
    }

    switch (playbackStatus) {
      case 'loading':
        return 'Loading...';
      case 'playing':
        return `Playing: ${currentWord}`;
      case 'finished':
        if (processingMode === 'sentence' && glossTokens.length > 0) {
          return `Finished: ${glossTokens.join(' → ')}`;
        }
        return `Finished: ${currentWord}`;
      case 'error':
        return errorMessage || 'Error';
      default:
        return isAvatarReady ? 'Ready' : 'Initializing...';
    }
  };

  const getStatusColor = () => {
    if (isProcessing) return '#2196F3';
    switch (playbackStatus) {
      case 'playing':
        return '#4CAF50';
      case 'error':
        return '#f44336';
      case 'loading':
        return '#FF9800';
      default:
        return '#888';
    }
  };

  if (isCameraActive) {
    return <CameraTranslateScreen onBack={() => setIsCameraActive(false)} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f1e" />

      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View>
            <Text style={styles.title}>SignVision</Text>
            <Text style={styles.subtitle}>{getWordCount().toLocaleString()} signs available</Text>
          </View>
          <TouchableOpacity style={styles.cameraToggleBtn} onPress={() => setIsCameraActive(true)}>
            <Text style={styles.cameraToggleText}>📷 Sign ➔ English</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Mode Toggle */}
      <View style={styles.modeToggle}>
        <Text style={[styles.modeText, processingMode === 'word' && styles.modeTextActive]}>
          Word
        </Text>
        <Switch
          value={processingMode === 'sentence'}
          onValueChange={toggleMode}
          trackColor={{ false: '#3a3a5a', true: '#4CAF50' }}
          thumbColor={processingMode === 'sentence' ? '#fff' : '#888'}
        />
        <Text style={[styles.modeText, processingMode === 'sentence' && styles.modeTextActive]}>
          Sentence
        </Text>
      </View>

      <View style={styles.searchContainer}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmit={handleSearch}
          isLoading={playbackStatus === 'loading' || isProcessing}
          disabled={!isAvatarReady}
          placeholder={processingMode === 'sentence' ? 'Speak or type a sentence...' : 'Search for a word...'}
        />
      </View>

      {/* GLOSS Preview (sentence mode) */}
      {processingMode === 'sentence' && glossTokens.length > 0 && (
        <View style={styles.glossContainer}>
          <Text style={styles.glossLabel}>GLOSS:</Text>
          <View style={styles.glossTokens}>
            {glossTokens.map((token, index) => (
              <View
                key={`${token}-${index}`}
                style={[
                  styles.glossToken,
                  index === currentQueueIndex && playbackStatus === 'playing' && styles.glossTokenActive
                ]}
              >
                <Text style={styles.glossTokenText}>{token}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.avatarContainer}>
        <AvatarWebView
          ref={avatarRef}
          onReady={handleAvatarReady}
          onPlaying={handlePlaying}
          onFinished={handleFinished}
          onError={handleError}
          onStatusChange={handleStatusChange}
        />

        <View style={styles.statusBar}>
          {isProcessing ? (
            <ActivityIndicator size="small" color="#2196F3" style={styles.statusSpinner} />
          ) : (
            <View style={[styles.statusIndicator, { backgroundColor: getStatusColor() }]} />
          )}
          <Text style={styles.statusText}>{getStatusText()}</Text>
          {(playbackStatus === 'playing' || signQueue.length > 0) && (
            <TouchableOpacity style={styles.stopButton} onPress={handleStop}>
              <Text style={styles.stopButtonText}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {suggestions.length > 0 && (
        <View style={styles.suggestionsContainer}>
          <Text style={styles.sectionTitle}>Did you mean?</Text>
          <View style={styles.suggestionChips}>
            {suggestions.map((word) => (
              <TouchableOpacity
                key={word}
                style={styles.suggestionChip}
                onPress={() => handleSuggestionPress(word)}
              >
                <Text style={styles.suggestionChipText}>{word}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <View style={styles.historyContainer}>
        <View style={styles.historyHeader}>
          <Text style={styles.sectionTitle}>Recent Searches</Text>
          {searchHistory.length > 0 && (
            <TouchableOpacity onPress={clearHistory}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          data={searchHistory}
          keyExtractor={(item) => `${item.word}-${item.timestamp}`}
          horizontal
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.historyItem,
                !item.found && styles.historyItemNotFound,
              ]}
              onPress={() => handleHistoryPress(item)}
            >
              <Text style={styles.historyItemText}>{item.word}</Text>
              {!item.found && <Text style={styles.notFoundBadge}>✕</Text>}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyHistoryText}>No recent searches</Text>
          }
          contentContainerStyle={styles.historyList}
        />
      </View>
    </SafeAreaView>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 40 : 10,
    paddingBottom: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cameraToggleBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cameraToggleText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  modeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 12,
  },
  modeText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  modeTextActive: {
    color: '#4CAF50',
    fontWeight: '600',
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    zIndex: 10,
  },
  glossContainer: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  glossLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6,
  },
  glossTokens: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  glossToken: {
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  glossTokenActive: {
    backgroundColor: '#4CAF50',
  },
  glossTokenText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  avatarContainer: {
    flex: 1,
    marginHorizontal: 20,
    marginVertical: 10,
    maxHeight: width * 1.2,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    marginTop: -16,
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  statusSpinner: {
    marginRight: 10,
  },
  statusText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  stopButton: {
    backgroundColor: '#f44336',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
  },
  stopButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  suggestionsContainer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginBottom: 10,
  },
  suggestionChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionChip: {
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  suggestionChipText: {
    color: '#4CAF50',
    fontSize: 13,
  },
  historyContainer: {
    paddingTop: 10,
    paddingBottom: 20,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  clearText: {
    color: '#f44336',
    fontSize: 13,
  },
  historyList: {
    paddingHorizontal: 20,
    gap: 8,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a4a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  historyItemNotFound: {
    backgroundColor: '#3a2a2a',
    borderWidth: 1,
    borderColor: '#f4433666',
  },
  historyItemText: {
    color: '#fff',
    fontSize: 13,
  },
  notFoundBadge: {
    color: '#f44336',
    marginLeft: 6,
    fontSize: 10,
  },
  emptyHistoryText: {
    color: '#666',
    fontSize: 13,
    fontStyle: 'italic',
  },
});

export default HomeScreen;
