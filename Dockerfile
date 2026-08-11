# ── Build mərhələsi ───────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# API ünvanı: default olaraq BOŞ saxlanılır — bu, nisbi ünvan deməkdir və
# sorğular eyni mənşədən gedir, nginx onları backend konteynerinə ötürür.
# Yalnız frontend backend-dən AYRI hostda dursa konkret ünvan verilir:
#   docker build --build-arg VITE_API_URL=http://baska-host:5199 .
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ── Servis mərhələsi (nginx) ──────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
