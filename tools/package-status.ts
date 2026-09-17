// Run with Python -S: existing runtimes may contain a legacy sitecustomize.py
// that imports torch. Adding metadata search paths manually does not execute
// sitecustomize, .pth hooks, or the packages being inspected.
export const PACKAGE_STATUS_SCRIPT = [
  'import sys, json, os, glob',
  'from importlib.metadata import version, PackageNotFoundError',
  'paths = [os.path.join(sys.argv[1], "Lib", "site-packages")] if os.name == "nt" else glob.glob(os.path.join(sys.argv[1], "lib", "python*", "site-packages"))',
  'sys.path.extend(paths)',
  'result = {"python": {"ok": True, "output": ".".join(map(str, sys.version_info[:3]))}}',
  'for package in ["faster-whisper", "ctranslate2", "openai-whisper", "torch", "nvidia-cublas-cu12", "nvidia-cudnn-cu12"]:',
  '    try: result[package] = {"ok": True, "output": version(package)}',
  '    except PackageNotFoundError: result[package] = {"ok": False}',
  'print(json.dumps(result))',
].join('\n');
