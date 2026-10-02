# 502 Bad Gateway — giriş zamanı xəta

> Simptom: sayt açılır, login səhifəsi normal görünür, amma **Daxil ol** düyüsünə
> basanda xəta panelində `502 Bad Gateway — nginx/1.31.6` yazısı çıxır.

## Səbəb nədir

Deploy quruluşunda üç konteyner var:

| Konteyner | Image | Host portu |
|---|---|---|
| `isp-db` | `mysql:8.4` | yoxdur (yalnız daxili) |
| `isp-backend` | `mmu-ixtisas-backend:latest` | yoxdur (yalnız daxili, 5199) |
| `isp-frontend` | `mmu-ixtisas-frontend:latest` | `5174:80` |

Saytı verən nginx `/api/` ilə başlayan bütün sorğuları daxili şəbəkə üzrə
`http://backend:5199` ünvanına ötürür:

```nginx
location /api/ {
    proxy_pass http://backend:5199;
}
```

**502 = nginx işləyir, amma `backend:5199` cavab vermir.** Yəni:

- problem şifrədə, istifadəçi adında və ya saytda deyil;
- frontend konteyneri sağlamdır (onsuz səhifə heç açılmazdı);
- backend konteyneri ya işləmir, ya qalxmağa çalışıb çökür, ya hələ başlayır,
  ya da baza (`db`) `healthy` olmadığı üçün heç başlamayıb —
  `backend` servisində `depends_on: db: condition: service_healthy` var.

## Diaqnostika

Bütün əmrlər `docker-compose.offline.yml` faylının yerləşdiyi qovluqda
(adətən `C:\ISP`) işlədilir.

### 1. Konteynerlərin vəziyyəti

```bash
docker compose -f docker-compose.offline.yml ps
```

Gözlənilən: hər üçü `Up`, `isp-db` yanında `(healthy)`.

### 2. Backend logu — əsas cavab buradadır

```bash
docker logs --tail 50 isp-backend
```

### 3. Baza logu

```bash
docker logs --tail 40 isp-db
```

### 4. Image-lərin yoxlanması

```bash
docker images | findstr mmu-ixtisas
```

`mmu-ixtisas-backend:latest` və `mmu-ixtisas-frontend:latest` — ikisi də
görünməlidir.

## Tipik hallar və həlli

### A) `isp-backend` siyahıda yoxdur

Ən çox rast gəlinən səhv: konteynerlər `docker run` ilə bir-bir başladılır.
Bu halda ortaq şəbəkə yaranmır, nginx `backend` adını DNS-də tapa bilmir və
nəticə **həmişə** 502 olur. Düzgün yol — compose ilə başlatmaq:

```bash
docker compose -f docker-compose.offline.yml up -d
```

### B) Image yüklənməyib / yarımçıqdır

`docker images` siyahısında backend image görünmürsə, arxiv tam açılmamışdır:

```bash
docker load -i isp-images.tar
```

Sonra yenidən `up -d`.

### C) `isp-backend` `Restarting` döngəsindədir

Backend qalxarkən çökür. Səbəb `docker logs isp-backend` çıxışında yazılır —
ən çox baza miqrasiyası (`db.Database.Migrate()`) və ya əlaqə sətri ilə bağlı olur.

### D) `isp-db` `health: starting` və ya `unhealthy` qalıb

Backend bazanın sağlam olmasını gözləyir; baza qalxmasa backend heç başlamır.
`docker logs isp-db` çıxışına baxın. Adi səbəblər: diskdə yer yoxdur, yaxud
`isp_mysqldata` volume-u yarımçıq qalıb.

Həmin komputerdəki baza **hələ heç bir dəyərli data saxlamırsa** təmiz
başlanğıc verin:

```bash
docker compose -f docker-compose.offline.yml down -v && docker compose -f docker-compose.offline.yml up -d
```

> ⚠ `-v` açarı həmin komputerdəki bazanı **tamamilə silir**. Orada artıq iş
> görülübsə, əvvəlcə nüsxə götürün:
> ```bash
> docker exec isp-db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --events mmuisp' > baza-nusxe.sql
> ```
> Parol əmr sətrində yazılmır — konteynerin öz env dəyişənindən oxunur.

### E) İlk 30 saniyə — keçici 502

Baza tam yeni qurulanda backend miqrasiyaları işlədir və ilk superadmini
yaradır. Bu zaman qısa müddət 502 normaldır. Bir-iki dəqiqə sonra keçmirsə,
bu artıq real nasazlıqdır — yuxarıdaki addımlara qayıdın.

## Nəzərə alınmalı iki məqam

1. **Baza portu bağlıdır.** Workbench kimi alətlə qoşulmaq lazımdırsa,
   compose faylında `db` servisinin `ports: - "3307:3306"` sətirlərini açın.
2. **Backend portu da bağlıdır.** Swagger-i birbaşa yoxlamaq lazım olarsa,
   `backend` servisində `ports: - "5199:5199"` sətirlərini açın və
   `ASPNETCORE_ENVIRONMENT` dəyərini `Development` edin.
