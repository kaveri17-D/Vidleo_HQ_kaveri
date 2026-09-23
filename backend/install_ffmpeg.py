import os
import zipfile
import shutil
import urllib.request
import traceback

FFMPEG_URL = "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-win-64.zip"
FFPROBE_URL = "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffprobe-4.4.1-win-64.zip"

BIN_DIR = "bin"
os.makedirs(BIN_DIR, exist_ok=True)

def download_and_extract(url, name):
    zip_path = f"{name}.zip"
    print(f"[{name}] Downloading from {url} ...")
    try:
        urllib.request.urlretrieve(url, zip_path)
        print(f"[{name}] Extracting...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(BIN_DIR)
        print(f"[{name}] Installed successfully in {BIN_DIR}!")
    except Exception as e:
        print(f"[{name}] Error: {e}")
        traceback.print_exc()
    finally:
        if os.path.exists(zip_path):
            os.remove(zip_path)

if __name__ == "__main__":
    print("=======================================")
    print("  NEXUS - Installing Audio Engine (FFmpeg)")
    print("=======================================")
    download_and_extract(FFMPEG_URL, "FFmpeg")
    download_and_extract(FFPROBE_URL, "FFprobe")
    print("\n✅ All done! Restart your NEXUS backend server to enable Audio extractions.")
