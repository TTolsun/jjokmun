# Offline PlantUML runtime

`plantuml.js` and `viz-global.js` are byte-for-byte copies from `@plantuml/core@1.2026.10`. The MIT-licensed TeaVM JavaScript build runs inside the extension sandbox. Class and other layout-based diagrams use the build's embedded Graphviz WebAssembly through Viz.js. No runtime download is required. [Official package](https://www.npmjs.com/package/@plantuml/core/v/1.2026.10) · [Upstream build](https://github.com/plantuml/plantuml/blob/master/PUBLISHING_NPM.md)

| SHA-256 | File |
| --- | --- |
| `00e3d2849d443dd77d6ca9bdf8aedc63bd26ff86025972b617cb96f4678655ca` | `plantuml-core-1.2026.10.tgz` |
| `c6664799aaa464319b5e1070a69850b93a7ea23ee41a23e920a8f2086e7da21c` | `plantuml.js` |
| `fc6ca2de83dd4e3fca967d5214122777890a5cd1ab101115a1f716fc84e6dc5e` | `viz-global.js` |

The package includes Viz.js 3.24.0, Graphviz 14.1.1, and Expat 2.7.3. The accompanying notices are in `LICENSE`, `LICENSE-Viz.txt`, `LICENSE-Graphviz.txt`, and `LICENSE-Expat.txt`. [Viz.js source](https://github.com/mdaines/viz-js/tree/v3) · [Graphviz 14.1.1 source](https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/14.1.1/graphviz-14.1.1.tar.gz) · [Expat 2.7.3 source](https://github.com/libexpat/libexpat/tree/R_2_7_3)
