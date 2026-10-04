FROM python:3.11-slim
RUN pip install --no-cache-dir onnxruntime==1.20.1 numpy==2.1.3 pillow==11.0.0
ADD https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx /models/silueta.onnx
RUN chmod 644 /models/silueta.onnx
COPY server.py /app/server.py
USER nobody
EXPOSE 7000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7000/')"
CMD ["python", "/app/server.py"]
