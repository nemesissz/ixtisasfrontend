# İSP ikon şrifti (`public/fonts/isp-icons.woff2`)

Açıq rejimdə emoji ikonları sidebar-dakı kimi xətti (Lucide) ikonlarla göstərmək üçün
kiçik şrift. Emoji kod nöqtələri Lucide glyph-lərinə yönləndirilir, `U+FE0F` boş glyph-ə
və cmap 14-ə düşür — beləcə `⚠️` kimi ardıcıllıqlar da rəngli emojiyə keçmir.
Siyahıda olmayan emojilər (məs. rəngli dairələr 🟢) olduğu kimi qalır.

Yenidən qurmaq (emoji → ikon xəritəsi `build.py`-dəki `MAP`-dadır):

```bash
pip install fonttools brotli
npm pack lucide-static && tar xzf lucide-static-*.tgz
python3 build.py ../../public/fonts/isp-icons.woff2 1.1 350 package/font
```
