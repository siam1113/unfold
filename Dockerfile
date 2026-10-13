FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY . .
RUN npm ci --no-audit --no-fund && npx playwright install --with-deps chromium && npm run build && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 4310 4174
CMD ["npm", "start"]
