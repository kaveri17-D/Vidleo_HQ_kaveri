import os
import urllib.request
import zipfile
import shutil
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
ZIP_PATH = "ffmpeg.zip"
EXTRACT_DIR = "ffmpeg_temp"
BIN_DIR = "bin"

def main():
    print("Downloading FFmpeg from GitHub...")
    urllib.request.urlretrieve(URL, ZIP_PATH)
    
    print("Extracting...")
    with zipfile.ZipFile(ZIP_PATH, 'r') as zip_ref:
        zip_ref.extractall(EXTRACT_DIR)
        
    print("Moving binaries...")
    os.makedirs(BIN_DIR, exist_ok=True)
    
    # Locate the bin folder inside the extracted dict
    for root, dirs, files in os.walk(EXTRACT_DIR):
        if os.path.basename(root) == "bin":
            for file in files:
                if file.endswith(".exe"):
                    shutil.copy2(os.path.join(root, file), BIN_DIR)
                    print(f"Copied {file} to {BIN_DIR}")
                    
    print("Cleaning up...")
    os.remove(ZIP_PATH)
    shutil.rmtree(EXTRACT_DIR)
    print("Done! FFmpeg is installed in backend/bin.")

if __name__ == "__main__":
    main()
