# İxtisas Seçim Proqramı — Quraşdırma Təlimatı (Docker)

Layihəni istənilən kompüterdə/serverdə işə salmaq üçün yeganə tələb **Docker**-dir
(Windows/Mac: Docker Desktop, Linux: Docker Engine + compose plugin).
MySQL, .NET, Node.js — heç nə ayrıca quraşdırılmır, hamısı konteynerlərdədir.

## 1. Reposları yanaşı klonlayın

```bash
mkdir isp && cd isp
git clone https://github.com/byValizada/MMU-isp.git mmu-ixtisas
cd mmu-ixtisas && git checkout newapifrontend && cd ..
git clone https://github.com/nemesissz/ixtisasbackend.git
```

Nəticə düzümü:

```
isp/
├── mmu-ixtisas/      (frontend + docker-compose.yml)
└── ixtisasbackend/   (backend)
```

## 2. İşə salın

```bash
cd mmu-ixtisas
docker compose up -d --build
```

İlk build 5–10 dəqiqə çəkir (image-lər yüklənir); sonrakılar keş sayəsində sürətlidir.

## 3. Açın

| Nə | Ünvan |
|---|---|
| Veb interfeys | http://localhost:5174 |
| API / Swagger | http://localhost:5199/swagger |
| İlkin giriş | istifadəçi `admin` · parol `Admin@2026` |

## Gündəlik əmrlər

```bash
docker compose ps                        # vəziyyət
docker compose logs backend --tail 50    # backend logları
docker compose down                      # dayandır (data qalır)
docker compose up -d                     # yenidən başlat
docker compose up -d --build             # kod yeniləndikdən sonra
docker compose down -v                   # ⚠ bazanı tam sıfırla
```

## Kod yeniləndikdə

```bash
# frontend dəyişibsə
cd mmu-ixtisas && git pull origin newapifrontend && docker compose up -d --build frontend

# backend dəyişibsə
cd ixtisasbackend && git pull && cd ../mmu-ixtisas && docker compose up -d --build backend
```

## Serverdə (çoxistifadəçili) quraşdırma

Bütün istifadəçilərin eyni bazanı görməsi üçün stack bir serverdə qaldırılır:

1. `docker-compose.yml`-də frontend build arqumentini serverin ünvanı ilə dəyişin:
   ```yaml
   VITE_API_URL: "http://SERVER_IP:5199"
   ```
2. `docker compose up -d --build`
3. İstifadəçilər brauzerdən `http://SERVER_IP:5174` açır.

> İstehsal mühitində `docker-compose.yml`-dəki DB parolunu və `Jwt__Key`-i
> mütləq dəyişin.

## İnternetsiz (qapalı şəbəkə) köçürmə

İnternetli maşında image-ləri fayla çıxarın:

```bash
docker compose build
docker save mmu-ixtisas-frontend mmu-ixtisas-backend mariadb:11 -o isp-images.tar
```

Hədəf maşında (Docker quraşdırılmış):

```bash
docker load -i isp-images.tar
docker compose up -d          # --build lazım deyil
```

## Problemlər

| Problem | Həll |
|---|---|
| Docker Desktop açılmır (Windows) | `wsl --update` işlədin, sonra Docker-i yenidən başladın |
| Port məşğuldur (5174/5199/3307) | compose-da sol tərəfdəki portu dəyişin, məs. `"8080:80"` |
| Backend bazaya qoşulmur | `docker compose logs db` — db "healthy" olana qədər gözləyin |
