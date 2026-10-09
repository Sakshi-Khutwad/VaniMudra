// API Configuration
// Using ADB reverse proxy: run `adb reverse tcp:8000 tcp:8000`
const API_CONFIG = {
  baseUrl: process.env.EXPO_PUBLIC_CORE_API_URL || (__DEV__ 
    ? 'http://10.99.60.213:8000'
    : 'https://your-production-api.com'),
  timeout: 60000,
  retries: 3,
  retryDelay: 1000,
};

export interface GlossResult {
  subject: string | null;
  object: string | null;
  verb: string | null;
  tense: string;
  negation: boolean;
  question: boolean;
  gloss: string[];
}

export interface SignLookup {
  word: string;
  original_query: string;
  found: boolean;
  s3_url: string | null;
  match_type: 'exact' | 'anchor' | 'partial' | 'semantic' | 'none';
  similar_words: string[];
}

export interface ProcessingResult {
  gloss: GlossResult;
  signs: SignLookup[];
}

export interface ProcessResponse {
  success: boolean;
  text: string;
  results: ProcessingResult[];
  error?: string;
}

export interface LookupResponse {
  success: boolean;
  word: string;
  original_query: string;
  found: boolean;
  s3_url: string | null;
  match_type: string;
  similar_words: string[];
}

export interface SearchResponse {
  success: boolean;
  query: string;
  results: Array<{
    word: string;
    similarity: number;
  }>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown,
    public isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.isRetryable;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      error.name === 'AbortError' ||
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('failed to fetch') ||
      msg.includes('connection')
    );
  }
  return false;
}

async function apiRequestWithRetry<T>(
  endpoint: string,
  options: RequestInit = {},
  retriesLeft: number = API_CONFIG.retries
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

  try {
    const response = await fetch(`${API_CONFIG.baseUrl}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      const isRetryable = response.status >= 500 || response.status === 429;
      throw new ApiError(
        `API error: ${response.status} ${response.statusText}`,
        response.status,
        errorBody,
        isRetryable
      );
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (retriesLeft > 0 && isRetryableError(error)) {
      console.log(`[API] Retry ${API_CONFIG.retries - retriesLeft + 1}/${API_CONFIG.retries} for ${endpoint}`);
      await sleep(API_CONFIG.retryDelay * (API_CONFIG.retries - retriesLeft + 1));
      return apiRequestWithRetry<T>(endpoint, options, retriesLeft - 1);
    }

    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new ApiError('Request timeout - check your connection', undefined, undefined, true);
      }
      throw new ApiError(`Network error: ${error.message}`, undefined, undefined, true);
    }

    throw new ApiError('Unknown error occurred');
  }
}

export async function processSentence(text: string): Promise<ProcessResponse> {
  return apiRequestWithRetry<ProcessResponse>('/process', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function transcribeAudio(audioUri: string): Promise<ProcessResponse> {
  const formData = new FormData();
  const filename = audioUri.split('/').pop() || 'audio.wav';
  
  formData.append('file', {
    uri: audioUri,
    type: 'audio/wav',
    name: filename,
  } as unknown as Blob);

  let retriesLeft = API_CONFIG.retries;
  
  while (retriesLeft >= 0) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/transcribe`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new ApiError(
          `Transcription failed: ${response.statusText}`,
          response.status,
          errorBody,
          response.status >= 500
        );
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (retriesLeft > 0 && isRetryableError(error)) {
        console.log(`[API] Transcribe retry ${API_CONFIG.retries - retriesLeft + 1}/${API_CONFIG.retries}`);
        await sleep(API_CONFIG.retryDelay * (API_CONFIG.retries - retriesLeft + 1));
        retriesLeft--;
        continue;
      }

      if (error instanceof ApiError) throw error;
      if (error instanceof Error) {
        throw new ApiError(`Transcription error: ${error.message}`, undefined, undefined, true);
      }
      throw new ApiError('Unknown transcription error');
    }
  }
  
  throw new ApiError('Transcription failed after retries');
}

export async function lookupWordApi(word: string): Promise<LookupResponse> {
  const encoded = encodeURIComponent(word.trim());
  return apiRequestWithRetry<LookupResponse>(`/lookup/${encoded}`);
}

export async function semanticSearch(
  query: string,
  limit: number = 5
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    query: query.trim(),
    limit: limit.toString(),
  });
  return apiRequestWithRetry<SearchResponse>(`/search?${params}`);
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${API_CONFIG.baseUrl}/`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

export function setApiBaseUrl(url: string): void {
  API_CONFIG.baseUrl = url;
}

export function getApiBaseUrl(): string {
  return API_CONFIG.baseUrl;
}

export const VIDEO_API_CONFIG = {
  baseUrl: process.env.EXPO_PUBLIC_VIDEO_API_URL || (__DEV__ 
    ? 'http://10.99.60.213:8001'
    : 'https://your-video-api.com'),
  timeout: 60000,
  retries: 3,
  retryDelay: 1000,
};

export interface TranslateVideoResponse {
  translation: string;
}

export async function translateVideoClip(videoData: string | Blob): Promise<TranslateVideoResponse> {
  const formData = new FormData();
  
  if (typeof videoData === 'string') {
    const filename = videoData.split('/').pop() || 'video.mp4';
    formData.append('video', {
      uri: videoData,
      type: 'video/mp4',
      name: filename,
    } as unknown as Blob);
  } else {
    formData.append('video', videoData, 'video.webm');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VIDEO_API_CONFIG.timeout);

  try {
    const response = await fetch(`${VIDEO_API_CONFIG.baseUrl}/api/translate-video`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ApiError(
        `Video translation failed: ${response.statusText}`,
        response.status,
        errorBody,
        response.status >= 500
      );
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) throw error;
    if (error instanceof Error) {
      throw new ApiError(`Video upload error: ${error.message}`, undefined, undefined, false);
    }
    throw new ApiError('Unknown video processing error');
  }
}
