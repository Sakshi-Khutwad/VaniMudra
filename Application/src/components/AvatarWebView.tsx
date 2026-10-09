import React, { useRef, useCallback, forwardRef, useImperativeHandle, useEffect, useState } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import type { AvatarMessage, WebViewOutgoingMessage } from '../types';

const AVATAR_HTML_CONTENT = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>SignVision Avatar</title>
    <link rel="stylesheet" href="https://vhg.cmp.uea.ac.uk/tech/jas/vhg2020/cwa/cwasa.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; background: #1a1a2e; }
        .main { display: flex; flex-direction: column; width: 100%; height: 100%; position: relative; }
        .avatar-wrap { flex: 1; display: flex; align-items: center; justify-content: center; }
        .CWASAAvatar { width: 100% !important; height: 100% !important; max-width: 450px; max-height: 550px; }
        .hidden { display: none !important; }
        .status { position: absolute; bottom: 15px; left: 50%; transform: translateX(-50%);
            background: rgba(0,0,0,0.75); color: #fff; padding: 8px 20px; border-radius: 20px; font-size: 13px; }
        .status.fade { opacity: 0; transition: opacity 0.3s; }
        .spinner { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
            width: 50px; height: 50px; border: 4px solid rgba(255,255,255,0.2);
            border-top-color: #4CAF50; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: translate(-50%,-50%) rotate(360deg); } }
        .word-badge { position: absolute; top: 10px; left: 10px; background: #4CAF50; color: #fff;
            padding: 6px 14px; border-radius: 15px; font-weight: 600; font-size: 13px; }
        .ctrl { position: absolute; top: 10px; right: 10px; }
        .ctrl button { background: rgba(255,255,255,0.15); border: none; color: #fff;
            padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 12px; }
        .ctrl button:hover { background: rgba(255,255,255,0.25); }
    </style>
</head>
<body>
    <div class="main">
        <div class="word-badge hidden" id="wordBadge"></div>
        <div class="ctrl"><button onclick="doStop()">Stop</button></div>
        <div class="avatar-wrap">
            <div class="CWASAAvatar av0" id="avatarDiv"></div>
        </div>
        <div class="spinner" id="spinner"></div>
        <div class="status" id="status">Initializing...</div>
    </div>
    
    <div style="display:none">
        <input type="text" class="txtSiGMLURL av0" id="inpURL">
        <button class="bttnPlaySiGMLURL av0" id="btnPlay">Play</button>
        <button class="bttnStop av0" id="btnStop">Stop</button>
        <input type="text" class="statusExtra av0" id="inpStatus">
        <select class="menuAv av0" id="selAv"><option value="anna" selected>anna</option></select>
    </div>
    <div class="SToCA"></div>

    <script>
        window.CWA_CFG_DATA = {
            jasBase: 'https://vhg.cmp.uea.ac.uk/tech/jas/vhg2020/',
            jasVersionTag: 'vhg2020',
            sigmlBase: 'sigml',
            avJARBase: 'avatars',
            avJSONBase: 'avjson',
            useAvatarJARs: true,
            animgenFPS: 30,
            avs: ['anna', 'marc', 'francoise'],
            avsfull: ['anna', 'marc', 'francoise', 'luna'],
            avSettings: [{
                width: 384, 
                height: 320, 
                avList: 'avs', 
                initAv: 'anna',
                initCamera: [0, 0.23, 3.24, 5, 18, 30, -1, -1],
                allowFrameSteps: true, 
                allowSiGMLText: true
            }]
        };
        
        window.CWA_CLIENT_CFG_DATA = {
            avSettings: [{
                width: 384,
                height: 320,
                avList: 'avs',
                initAv: 'anna',
                allowFrameSteps: true,
                allowSiGMLText: true
            }]
        };
    </script>
    <script src="https://vhg.cmp.uea.ac.uk/tech/jas/vhg2020/cwa/allcsa.js"></script>
    <script>
        var ready = false;
        var word = '';
        var initDone = false;
        var statusWatchStarted = false;
        var spinner, statusEl, wordBadge, inpURL, btnPlay, btnStop, inpStatus;

        function initElements() {
            spinner = document.getElementById('spinner');
            statusEl = document.getElementById('status');
            wordBadge = document.getElementById('wordBadge');
            inpURL = document.getElementById('inpURL');
            btnPlay = document.getElementById('btnPlay');
            btnStop = document.getElementById('btnStop');
            inpStatus = document.getElementById('inpStatus');
        }

        function msg(m) {
            var t = JSON.stringify(m);
            if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(t);
            } else {
                window.parent.postMessage(t, '*');
            }
        }

        function showStatus(t) { if(statusEl) { statusEl.textContent = t; statusEl.classList.remove('fade'); } }
        function hideStatus() { if(statusEl) statusEl.classList.add('fade'); }
        function showSpinner() { if(spinner) spinner.classList.remove('hidden'); }
        function hideSpinner() { if(spinner) spinner.classList.add('hidden'); }
        function showWord(w) { if(wordBadge) { wordBadge.textContent = w.toUpperCase(); wordBadge.classList.remove('hidden'); } }
        function hideWord() { if(wordBadge) wordBadge.classList.add('hidden'); }

        function initCWASA() {
            if (initDone) return;
            initDone = true;
            
            initElements();
            showStatus('Loading avatar...');
            
            try {
                if (typeof CWASA !== 'undefined' && CWASA.init) {
                    CWASA.init(window.CWA_CFG_DATA, window.CWA_CLIENT_CFG_DATA);
                }
                
                setTimeout(function() {
                    ready = true;
                    hideSpinner();
                    showStatus('Ready');
                    msg({ type: 'ready' });
                    setTimeout(hideStatus, 2000);
                    if (!statusWatchStarted) {
                        statusWatchStarted = true;
                        watchStatus();
                    }
                }, 3500);
            } catch (e) {
                console.error('Init error:', e);
                showStatus('Init failed');
                msg({ type: 'error', message: 'Init failed' });
            }
        }

        var lastStatus = '';
        var isPlaying = false;

        function watchStatus() {
            setInterval(function() {
                if (!inpStatus) return;
                var s = inpStatus.value || '';
                if (s === lastStatus) return;
                
                console.log('CWASA Status:', JSON.stringify(s));
                msg({ type: 'status', status: s });
                lastStatus = s;
                
                var sLower = s.toLowerCase();
                
                if (sLower.indexOf('complete') >= 0 || sLower.indexOf('done') >= 0 || sLower.indexOf('finished') >= 0) {
                    if (isPlaying) {
                        isPlaying = false;
                        showStatus('Done'); 
                        msg({ type: 'finished', word: word });
                        setTimeout(function() { hideStatus(); hideWord(); }, 1000);
                    }
                } else if (sLower.indexOf('playing') >= 0 && sLower.indexOf('complete') < 0) { 
                    isPlaying = true;
                    showStatus('Playing: ' + word); 
                    msg({ type: 'playing', word: word }); 
                }
            }, 200);
        }

        function play(url, w) {
            if (!ready) { 
                console.log('Avatar not ready');
                msg({ type: 'error', message: 'Not ready' }); 
                return; 
            }
            if (!inpURL || !btnPlay) {
                initElements();
            }
            console.log('Playing:', url, w);
            word = w || '';
            lastStatus = '';
            isPlaying = false;
            showWord(word);
            showSpinner();
            showStatus('Loading...');
            inpURL.value = url;
            inpURL.dispatchEvent(new Event('change', { bubbles: true }));
            setTimeout(function() { 
                btnPlay.click(); 
                hideSpinner(); 
            }, 200);
        }

        function doStop() {
            if (btnStop) btnStop.click();
            hideWord();
            showStatus('Stopped');
            msg({ type: 'stopped' });
            setTimeout(hideStatus, 1500);
        }

        window.addEventListener('message', function(e) {
            try {
                var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                if (d.type === 'play') play(d.url, d.word);
                else if (d.type === 'stop') doStop();
                else if (d.type === 'ping') msg({ type: 'pong', initialized: ready });
            } catch (err) {}
        });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initCWASA);
        } else {
            initCWASA();
        }
    </script>
</body>
</html>
`;

let blobUrlCache: string | null = null;

function getBlobUrl(): string {
  if (!blobUrlCache) {
    const blob = new Blob([AVATAR_HTML_CONTENT], { type: 'text/html' });
    blobUrlCache = URL.createObjectURL(blob);
  }
  return blobUrlCache;
}

export interface AvatarWebViewRef {
  play: (url: string, word: string) => void;
  stop: () => void;
  ping: () => void;
}

interface AvatarWebViewProps {
  onReady?: () => void;
  onPlaying?: (word: string) => void;
  onFinished?: (word: string) => void;
  onError?: (message: string) => void;
  onStatusChange?: (status: string, gloss?: string) => void;
}

const AvatarWebView = forwardRef<AvatarWebViewRef, AvatarWebViewProps>(
  ({ onReady, onPlaying, onFinished, onError, onStatusChange }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const webViewRef = useRef<any>(null);
    const [blobUrl] = useState(() => Platform.OS === 'web' ? getBlobUrl() : '');

    const sendMessage = useCallback((message: WebViewOutgoingMessage) => {
      if (Platform.OS === 'web') {
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify(message), '*');
      } else if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify(message));
      }
    }, []);

    useImperativeHandle(ref, () => ({
      play: (url: string, word: string) => {
        sendMessage({ type: 'play', url, word });
      },
      stop: () => {
        sendMessage({ type: 'stop' });
      },
      ping: () => {
        sendMessage({ type: 'ping' });
      },
    }));

    const handleMessage = useCallback((data: AvatarMessage) => {
      switch (data.type) {
        case 'ready':
          onReady?.();
          break;
        case 'playing':
          if (data.word) onPlaying?.(data.word);
          break;
        case 'finished':
          if (data.word) onFinished?.(data.word);
          break;
        case 'error':
          onError?.(data.message || 'Unknown error');
          break;
        case 'status':
          onStatusChange?.(data.status || '', data.gloss);
          break;
      }
    }, [onReady, onPlaying, onFinished, onError, onStatusChange]);

    useEffect(() => {
      if (Platform.OS === 'web') {
        const listener = (event: MessageEvent) => {
          try {
            const data: AvatarMessage = typeof event.data === 'string'
              ? JSON.parse(event.data)
              : event.data;
            handleMessage(data);
          } catch {
          }
        };
        window.addEventListener('message', listener);
        return () => window.removeEventListener('message', listener);
      }
    }, [handleMessage]);

    if (Platform.OS === 'web') {
      return (
        <View style={styles.container}>
          <iframe
            ref={iframeRef}
            src={blobUrl}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              borderRadius: 16,
            }}
            allow="accelerometer; autoplay; encrypted-media; gyroscope"
          />
        </View>
      );
    }

    const WebView = require('react-native-webview').WebView;

    const handleWebViewMessage = (event: any) => {
      try {
        const data: AvatarMessage = JSON.parse(event.nativeEvent.data);
        handleMessage(data);
      } catch (error) {
        console.error('Error parsing WebView message:', error);
      }
    };

    const injectedJavaScript = `
      (function() {
        if (!window.ReactNativeWebView) {
          window.ReactNativeWebView = {
            postMessage: function(data) { window.postMessage(data, '*'); }
          };
        }
        document.addEventListener('message', function(e) {
          window.dispatchEvent(new MessageEvent('message', { data: e.data }));
        });
        true;
      })();
    `;

    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ html: AVATAR_HTML_CONTENT }}
          style={styles.webview}
          onMessage={handleWebViewMessage}
          injectedJavaScript={injectedJavaScript}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          originWhitelist={['*']}
          {...(Platform.OS === 'android' && {
            androidHardwareAccelerationDisabled: false,
            androidLayerType: 'hardware',
          })}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          scalesPageToFit={true}
          mixedContentMode="compatibility"
          allowFileAccess={true}
          allowUniversalAccessFromFileURLs={true}
          onError={(syntheticEvent: any) => {
            const { nativeEvent } = syntheticEvent;
            console.error('WebView error:', nativeEvent);
            onError?.('WebView error: ' + nativeEvent.description);
          }}
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

export default AvatarWebView;
