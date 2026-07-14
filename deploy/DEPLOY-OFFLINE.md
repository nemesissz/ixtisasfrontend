# İxtisas Seçim Proqramı — Offline Server Quraşdırması (Ubuntu VM)

**Ssenari:** internetsiz (air-gapped) Windows kompüteri server kimi hazırlamaq.
Windows içində **bridged şəbəkəli Ubuntu VM** işləyəcək — o, LAN-da öz real
IP-si ilə "ayrıca server" kimi görünəcək, yüzlərlə kursant eyni anda qoşula bilər.

```
   Kursant cihazları (LAN)
        │  http://SERVER_IP
        ▼
   ┌─────────────────────────────┐
   │  Windows host                │
   │   └── Ubuntu VM (bridged)    │  ← real LAN IP
   │        └── Docker            │
   │             ├── nginx (:80)  │
   │             ├── backend      │
   │             └── mysql        │
   └─────────────────────────────┘
```

---

## FAZA 1 — İnternetli maşında hazırlıq (USB-yə yığmaq)

Bu faylların hamısını bir **USB**-yə köçürün:

| Fayl | Nə üçün | Ölçü |
|---|---|---|
| `ubuntu-24.04-live-server-amd64.iso` | Ubuntu Server ISO | ~2.6 GB |
| `isp-images.tar` | Hazır Docker image-ləri (mysql+backend+frontend) | ~360 MB |
| `docker-static.tgz` + `docker-compose-plugin` | Docker offline binarları | ~70 MB |
| `docker-compose.prod.yml` | İstehsal konfiqurasiyası | kiçik |
| `HƏHİ_Şablon_doldurulmuş.xlsx` və s. | Kursant idxal şablonları | kiçik |

**Yükləmə linkləri (internetli maşında):**
- Ubuntu Server: https://ubuntu.com/download/server
- Docker static binary: https://download.docker.com/linux/static/stable/x86_64/
- (image-ləri və compose-u mən hazırladım — bu qovluqdadır)

---

## FAZA 2 — Windows-da VM qurmaq

**A) Hyper-V ilə** (Windows Pro/Enterprise — daxildir):
1. "Turn Windows features on/off" → **Hyper-V** işarələ → yenidən başlat.
2. Hyper-V Manager → **Virtual Switch Manager** → **External** switch yarat
   (fiziki şəbəkə kartına bağla — bu "bridged" deməkdir).
3. **New → Virtual Machine:** RAM **6 GB+**, CPU **4+**, disk **40 GB+**,
   şəbəkə = yaratdığın External switch.
4. ISO-nu quraşdırma diski kimi göstər → başlat.

**B) VirtualBox ilə** (Windows Home üçün — USB-dən quraşdır):
1. VirtualBox installer-i işə sal.
2. New VM: Ubuntu 64-bit, RAM 6 GB+, disk 40 GB+.
3. **Settings → Network → Adapter 1 → "Bridged Adapter"** seç.
4. ISO-nu bağla → başlat.

---

## FAZA 3 — Ubuntu Server quraşdırmaq

1. Adi quraşdırma — istifadəçi adı, parol təyin et.
2. **OpenSSH server** seçimini işarələ (rahat idarə üçün).
3. Quraşdırma bitəndən sonra VM-ə daxil ol.
4. **Statik IP təyin et** (şəbəkədə sabit qalsın). `/etc/netplan/*.yaml`:
   ```yaml
   network:
     version: 2
     ethernets:
       eth0:                     # öz adaptör adınızla əvəz edin (ip a ilə baxın)
         dhcp4: no
         addresses: [10.202.139.50/24]   # şəbəkənizə uyğun boş IP
         routes:
           - to: default
             via: 10.202.139.1           # gateway
   ```
   Sonra: `sudo netplan apply`

---

## FAZA 4 — Docker quraşdırmaq (offline)

USB-ni VM-ə bağla (Hyper-V-də USB ötürmə / VirtualBox-da USB filter),
faylları kopyala, sonra:

```bash
# 1) Docker static binarını aç
tar xzvf docker-static.tgz
sudo cp docker/* /usr/local/bin/
sudo groupadd docker 2>/dev/null; sudo usermod -aG docker $USER

# 2) systemd servisi (dockerd avtomatik başlasın)
sudo tee /etc/systemd/system/docker.service > /dev/null <<'EOF'
[Unit]
Description=Docker
After=network.target
[Service]
ExecStart=/usr/local/bin/dockerd
Restart=always
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now docker

# 3) compose plugin
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo cp docker-compose-plugin /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# yoxla
docker version && docker compose version
```

---

## FAZA 5 — Tətbiqi işə salmaq

```bash
# 1) Hazır image-ləri yüklə (build yoxdur — offline)
docker load -i isp-images.tar

# 2) compose faylını qoy (parolları DƏYİŞ!)
nano docker-compose.prod.yml        # CHANGE_ME sətirlərini güclü parolla əvəz et

# 3) işə sal
docker compose -f docker-compose.prod.yml up -d

# 4) yoxla
docker compose -f docker-compose.prod.yml ps
```

**Firewall (port 80 açıq olsun):**
```bash
sudo ufw allow 80/tcp && sudo ufw allow 22/tcp && sudo ufw --force enable
```

---

## FAZA 6 — Kursantlar üçün

- Kursantlar öz cihazlarında brauzerdə açır: **`http://SERVER_IP`**
  (məs. `http://10.202.139.50`) — port yazmağa ehtiyac yoxdur (80).
- Admin girişi: `http://SERVER_IP` → `admin` / (təyin etdiyiniz parol).
- Kursant məlumatlarını admin paneldən Excel ilə idxal edin.
- **Real IP-lər loglara düşəcək** (əsl Linux — Docker Desktop problemi yoxdur).

---

## Yoxlama siyahısı (kursantlardan əvvəl)

- [ ] `docker compose ps` → 3 konteyner "Up"
- [ ] Başqa cihazdan `http://SERVER_IP` açılır
- [ ] Admin girişi işləyir, parollar dəyişilib
- [ ] Test kursant idxalı + bir test seçimi göndərilir
- [ ] Loglarda real IP görünür
- [ ] Yük testi (aşağıda) keçirilib

---

## Data ehtiyat nüsxəsi (vacib!)

Seçim gününün sonunda / vaxtaşırı:
```bash
docker exec isp-db mysqldump -uroot -p<PAROL> mmuisp > backup_$(date +%F).sql
```
Bu faylı USB-yə köçürün — server sınsa data qorunsun.
