FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 mak \
    && useradd --uid 10001 --gid mak --no-create-home mak \
    && install -d -m 700 -o mak -g mak /var/lib/mak
COPY mak_backend ./mak_backend
COPY manage.py ./
COPY .openai/drizzle ./.openai/drizzle
COPY data/catalog.json ./data/catalog.json
COPY index.html products.html product.html pricing.html style.css script.js admin.html admin.css admin.js ./
COPY images ./images
COPY vendor ./vendor
COPY deploy ./deploy
USER mak
ENTRYPOINT ["sh", "/app/deploy/entrypoint.sh"]
CMD ["gunicorn", "--config", "/app/deploy/gunicorn.conf.py", "mak_backend.wsgi:application"]
