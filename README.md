# Código visual LINA

Ferramentas para desenhar com a geometria do logotipo do LINA (Laboratório de Modelagem da Informação, UFC). Tudo o que elas produzem segue a própria regra de construção do logotipo: células quadradas numa grade de meia célula, cantos com raio de ¼ de célula, convexos onde o bloco está livre e côncavos onde ele encontra um vizinho. A exceção é o pontilhado, o padrão do banner da página inicial, cujos pontos variam de tamanho.

**Use online:** https://eugeniomoreira-iaud.github.io/lina-visual-code/

- **Células** (`grid.html`): posicione e mova células numa grade e veja a regra arredondá-las.
- **Texturas** (`texture.html`): padrões aleatórios com semente (dispersão, campo, pontilhado, glifos), com controle do espaço vazio, do formato e da paleta.
- **Imagens** (`image.html`): transforme uma foto em pontilhado ou bitmap, com o original ao lado do resultado.

As três exportam SVG; Texturas e Imagens também exportam PNG. Texturas e Imagens guardam os ajustes no endereço da página, então um link copiado reproduz o resultado (a imagem em si não vai no link). Células guarda o desenho no navegador.

## Rodar localmente

Sem etapa de build e sem dependências. Abra `index.html` no navegador ou sirva a pasta:

```sh
python3 -m http.server
```

## Tipografia

A interface usa a Neometric, uma fonte licenciada que não faz parte deste repositório. Sem ela, as páginas usam a fonte sem serifa do sistema. Para ver as páginas com a tipografia da marca na sua máquina, coloque estes arquivos numa pasta `font/` na raiz (ela é ignorada pelo git):

- `Neometric Light (Regular).otf`
- `Neometric Medium (Regular).otf`
- `Neometric Extra Bold (Bold).otf`

## Estrutura

- `lina-geometry.js`: o traçador de contornos usado pelas três ferramentas.
- `lina-texture.js`, `lina-image.js`: os motores de textura e de imagem.
- `lina-sample.js`: o retrato de exemplo, embutido para que as páginas funcionem também quando abertas direto do disco.
- `lina.css`: estilos compartilhados.
- `png/`: os logotipos do LINA.

O `CLAUDE.md` descreve a regra completa (em inglês).
