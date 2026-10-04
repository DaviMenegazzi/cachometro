# Recorte automático de fundo para stickers. Modelo "silueta" (família U²-Net, o mesmo do rembg),
# rodando direto no onnxruntime: ~300 MB de memória em vez de ~1,3 GB do rembg completo.
# POST /  (corpo = imagem PNG/JPEG)  ->  PNG transparente, cortado no contorno do objeto.
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort
from PIL import Image

opts = ort.SessionOptions()
opts.intra_op_num_threads = 1
opts.enable_cpu_mem_arena = False  # sem isso o onnxruntime guarda memória e chega perto do limite do container
opts.enable_mem_pattern = False
session = ort.InferenceSession('/models/silueta.onnx', opts, providers=['CPUExecutionProvider'])
INPUT = session.get_inputs()[0].name
MAX_SIDE = 512
MEAN, STD = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])


def cutout(data: bytes) -> bytes:
    img = Image.open(io.BytesIO(data)).convert('RGB')
    img.thumbnail((1024, 1024))
    # Mesmo pré-processamento do rembg para a família U²-Net: 320×320, normalizado pelo maior valor.
    x = np.asarray(img.resize((320, 320), Image.LANCZOS), dtype=np.float32)
    x = (x / max(x.max(), 1e-6) - MEAN) / STD
    pred = session.run(None, {INPUT: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    pred = (pred - pred.min()) / max(pred.max() - pred.min(), 1e-6)
    mask = Image.fromarray((pred * 255).astype(np.uint8)).resize(img.size, Image.LANCZOS)
    out = img.convert('RGBA')
    out.putalpha(mask)
    # Corta no contorno do objeto (com uma folguinha) para o sticker não ter borda vazia.
    box = Image.fromarray((np.asarray(mask) > 24).astype(np.uint8) * 255).getbbox()
    if box:
        pad = int(0.04 * max(img.size))
        out = out.crop((max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, img.width), min(box[3] + pad, img.height)))
    out.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    out.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            size = int(self.headers.get('content-length', 0))
            if not 0 < size <= 8 * 1024 * 1024:
                return self.send_error(413)
            png = cutout(self.rfile.read(size))
            self.send_response(200)
            self.send_header('content-type', 'image/png')
            self.send_header('content-length', str(len(png)))
            self.end_headers()
            self.wfile.write(png)
        except Exception:
            self.send_error(422)

    def do_GET(self):  # healthcheck
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *args):  # sem logs de imagens
        pass


ThreadingHTTPServer(('0.0.0.0', 7000), Handler).serve_forever()
