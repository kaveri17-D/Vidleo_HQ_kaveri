'use client';

import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Download, 
  Play, 
  Cpu, 
  Sparkles 
} from 'lucide-react';
import { 
  executeBrowserPipeline, 
  BrowserMediaProgress, 
  BrowserProcessResult, 
  BrowserOperationType 
} from '@/lib/browser-media';

interface BrowserMediaProcessorProps {
  mediaSource: Blob | File | string;
  sourceFilename?: string;
  operation?: BrowserOperationType;
  targetContainer?: 'mp4' | 'webm' | 'mp3' | 'm4a';
  onComplete?: (result: BrowserProcessResult) => void;
  onCancel?: () => void;
  onFallbackToServer?: (reason: string) => void;
  className?: string;
}

export function BrowserMediaProcessor({
  mediaSource,
  sourceFilename = 'media.mp4',
  operation = 'remux',
  targetContainer = 'mp4',
  onComplete,
  onCancel,
  onFallbackToServer,
  className = '',
}: BrowserMediaProcessorProps) {
  const [progress, setProgress] = useState<BrowserMediaProgress>({
    stage: 'idle',
    percent: 0,
    message: 'Ready for browser media processing',
  });
  const [result, setResult] = useState<BrowserProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startProcessing = useCallback(async () => {
    setError(null);
    setResult(null);
    setIsProcessing(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const processResult = await executeBrowserPipeline({
        operation,
        input: mediaSource,
        inputFilename: sourceFilename,
        targetContainer,
        signal: controller.signal,
        onProgress: (prog) => {
          setProgress(prog);
        },
      });

      setResult(processResult);
      setIsProcessing(false);
      if (onComplete) {
        onComplete(processResult);
      }
    } catch (err: any) {
      setIsProcessing(false);
      if (err.name === 'OperationCancelledError' || controller.signal.aborted) {
        setProgress({
          stage: 'cancelled',
          percent: 0,
          message: 'Operation cancelled by user.',
        });
        if (onCancel) onCancel();
      } else {
        const errorMsg = err?.message || 'Browser media rendering failed.';
        setError(errorMsg);
        setProgress({
          stage: 'error',
          percent: 0,
          message: errorMsg,
        });
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [mediaSource, sourceFilename, operation, targetContainer, onComplete, onCancel]);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsProcessing(false);
    if (onCancel) {
      onCancel();
    }
  }, [onCancel]);

  return (
    <div className={`p-5 rounded-2xl bg-[#0A0A0C]/90 text-white border border-white/10 backdrop-blur-xl shadow-2xl ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              Client Media Engine
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                ffmpeg.wasm
              </span>
            </h4>
            <p className="text-xs text-white/50">In-browser processing without server upload</p>
          </div>
        </div>

        {isProcessing && (
          <button
            onClick={handleCancel}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors border border-red-500/20"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
        )}
      </div>

      {/* Idle Trigger */}
      {!isProcessing && !result && !error && (
        <div className="text-center py-4">
          <button
            onClick={startProcessing}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-sm transition-all shadow-lg shadow-purple-900/30 active:scale-[0.99]"
          >
            <Sparkles className="w-4 h-4" />
            Render In Browser ({operation.toUpperCase()})
          </button>
        </div>
      )}

      {/* Progress Bar & Status */}
      {isProcessing && (
        <div className="space-y-3 py-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-white/80 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
              {progress.message}
            </span>
            <span className="font-mono text-purple-400 font-semibold">{progress.percent}%</span>
          </div>

          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden relative">
            <motion.div
              className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress.percent}%` }}
              transition={{ ease: 'easeOut', duration: 0.3 }}
            />
          </div>
        </div>
      )}

      {/* Ready Output */}
      {result && (
        <AnimatePresence>
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3 pt-2"
          >
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-xl">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Render complete! {result.outputFilename} ({(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB in {(result.processingTimeMs / 1000).toFixed(1)}s)
              </span>
            </div>

            <div className="flex gap-2 pt-1">
              <a
                href={result.downloadUrl}
                download={result.outputFilename}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors shadow-lg shadow-emerald-900/30"
              >
                <Download className="w-4 h-4" />
                Download Rendered Media
              </a>

              <a
                href={result.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Preview Media"
              >
                <Play className="w-4 h-4" />
              </a>
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Error & Fallback Banner */}
      {error && (
        <div className="space-y-3 pt-2">
          <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 p-3 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-red-400">Browser Rendering Failed</p>
              <p className="text-white/70 mt-0.5">{error}</p>
            </div>
          </div>

          {onFallbackToServer && (
            <button
              onClick={() => onFallbackToServer(error)}
              className="w-full py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors border border-white/15"
            >
              Fallback to Cloud Server Processing →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
