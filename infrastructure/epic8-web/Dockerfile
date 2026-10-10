FROM node:22-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_ENABLE_MOCKS=false \
    VITE_ENABLE_FAKE_MODEL=false \
    VITE_ENABLE_REAL_MODEL=true \
    VITE_API_BASE_URL=http://localhost:18000
RUN npm run build

FROM nginx:alpine
COPY infrastructure/epic8-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
EXPOSE 5173
