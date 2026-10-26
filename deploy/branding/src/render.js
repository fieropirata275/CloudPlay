// Regenera las imágenes del tema de arranque (Plymouth) con las fuentes y colores de la marca.
//   cd deploy/branding/src && node render.js   (necesita playwright)
const path = require("path");
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto("file://" + path.join(__dirname, "assets.html"));
  await p.evaluate(() => document.fonts.ready);
  for (const id of ["logo", "wordmark", "badge-master", "badge-slave", "badge-all", "dot-master", "dot-slave", "dot-all",
                    "ring-master", "ring-slave", "ring-all", "bar-bg", "bar-fill"]) {
    await (await p.$("#" + id)).screenshot({ path: path.join(__dirname, "..", "plymouth", id + ".png"), omitBackground: true });
  }
  await b.close();
})();
