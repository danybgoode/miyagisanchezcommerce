# Printed-edition PDF renderer — Cloud Run image.
# node:20-slim (Debian bookworm) + the distro Chromium (pulls its own runtime libs),
# so puppeteer-core drives a system binary instead of downloading one.
#   docker build -t <region>-docker.pkg.dev/<project>/print/print-pdf:latest services/print-pdf
FROM node:20-slim

ENV NODE_ENV=production \
    PORT=8080 \
    CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app

# Chromium + fonts (Liberation ≈ Arial for the retro headlines) + CA certs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-dejavu-core \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 8080
CMD ["node", "server.js"]
