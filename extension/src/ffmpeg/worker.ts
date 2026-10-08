/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import createFFmpegCore from '@ffmpeg/core';
import { CORE_URL, FFMessageType } from '../../../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/const.js';
import {
  ERROR_UNKNOWN_MESSAGE_TYPE,
  ERROR_NOT_LOADED,
  ERROR_IMPORT_FAILURE,
} from '../../../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js';

let ffmpeg: any;

const load = async ({ coreURL: _coreURL, wasmURL: _wasmURL, workerURL: _workerURL }: any = {}) => {
  const first = !ffmpeg;
  let coreFactory: any = (createFFmpegCore as any)?.default || createFFmpegCore;

  if (!coreFactory && (self as any).createFFmpegCore) {
    coreFactory = (self as any).createFFmpegCore;
  }

  // If not bundled, attempt fallback loading
  if (!coreFactory) {
    try {
      if (!_coreURL) _coreURL = CORE_URL;
      // when web worker type is `classic`
      (self as any).importScripts?.(_coreURL);
      coreFactory = (self as any).createFFmpegCore;
    } catch {
      if (!_coreURL || _coreURL === CORE_URL) {
        _coreURL = CORE_URL.replace('/umd/', '/esm/');
      }
      try {
        const mod = await import(/* @vite-ignore */ _coreURL);
        coreFactory = mod?.default || mod;
      } catch (err) {
        console.warn('[FFMPEG Worker] Fallback dynamic import failed:', err);
      }
    }
  }

  if (!coreFactory) {
    throw ERROR_IMPORT_FAILURE;
  }

  const coreURL = _coreURL || CORE_URL;
  const wasmURL = _wasmURL ? _wasmURL : coreURL.replace(/\.js$/g, '.wasm');
  const workerURL = _workerURL ? _workerURL : coreURL.replace(/\.js$/g, '.worker.js');

  ffmpeg = await coreFactory({
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
    locateFile: (path: string, prefix: string) => {
      if (path.endsWith('.wasm')) return wasmURL;
      if (path.endsWith('.worker.js')) return workerURL;
      return prefix + path;
    },
  });

  ffmpeg.setLogger((data: any) => self.postMessage({ type: FFMessageType.LOG, data }));
  ffmpeg.setProgress((data: any) => self.postMessage({
    type: FFMessageType.PROGRESS,
    data,
  }));
  return first;
};

const exec = ({ args, timeout = -1 }: any) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.exec(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const ffprobe = ({ args, timeout = -1 }: any) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.ffprobe(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const writeFile = ({ path, data }: any) => {
  ffmpeg.FS.writeFile(path, data);
  return true;
};

const readFile = ({ path, encoding }: any) => ffmpeg.FS.readFile(path, { encoding });

const deleteFile = ({ path }: any) => {
  ffmpeg.FS.unlink(path);
  return true;
};

const rename = ({ oldPath, newPath }: any) => {
  ffmpeg.FS.rename(oldPath, newPath);
  return true;
};

const createDir = ({ path }: any) => {
  ffmpeg.FS.mkdir(path);
  return true;
};

const listDir = ({ path }: any) => {
  const names = ffmpeg.FS.readdir(path);
  const nodes = [];
  for (const name of names) {
    const stat = ffmpeg.FS.stat(`${path}/${name}`);
    const isDir = ffmpeg.FS.isDir(stat.mode);
    nodes.push({ name, isDir });
  }
  return nodes;
};

const deleteDir = ({ path }: any) => {
  ffmpeg.FS.rmdir(path);
  return true;
};

const mount = ({ fsType, options, mountPoint }: any) => {
  const str = fsType;
  const fs = ffmpeg.FS.filesystems[str];
  if (!fs) return false;
  ffmpeg.FS.mount(fs, options, mountPoint);
  return true;
};

const unmount = ({ mountPoint }: any) => {
  ffmpeg.FS.unmount(mountPoint);
  return true;
};

self.onmessage = async ({ data: { id, type, data: _data } }: any) => {
  const trans: any[] = [];
  let data: any;
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) {
      throw ERROR_NOT_LOADED;
    }
    switch (type) {
      case FFMessageType.LOAD:
        data = await load(_data);
        break;
      case FFMessageType.EXEC:
        data = exec(_data);
        break;
      case FFMessageType.FFPROBE:
        data = ffprobe(_data);
        break;
      case FFMessageType.WRITE_FILE:
        data = writeFile(_data);
        break;
      case FFMessageType.READ_FILE:
        data = readFile(_data);
        break;
      case FFMessageType.DELETE_FILE:
        data = deleteFile(_data);
        break;
      case FFMessageType.RENAME:
        data = rename(_data);
        break;
      case FFMessageType.CREATE_DIR:
        data = createDir(_data);
        break;
      case FFMessageType.LIST_DIR:
        data = listDir(_data);
        break;
      case FFMessageType.DELETE_DIR:
        data = deleteDir(_data);
        break;
      case FFMessageType.MOUNT:
        data = mount(_data);
        break;
      case FFMessageType.UNMOUNT:
        data = unmount(_data);
        break;
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (e: any) {
    self.postMessage({
      id,
      type: FFMessageType.ERROR,
      data: e?.message || e?.toString(),
    });
    return;
  }
  if (data instanceof Uint8Array) {
    trans.push(data.buffer);
  }
  self.postMessage({ id, type, data }, trans);
};
