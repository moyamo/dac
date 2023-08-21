#!/bin/sh

# To change the logo, edit logo.tex and then execute this script

pdflatex logo.tex
pdflatex logo.tex

# See https://www.jvt.me/posts/2022/02/07/favicon-cli/
# See https://stackoverflow.com/questions/12179342/imagemagick-extend-canvas-with-transparent-background
FAVICON_INPUT="logo.pdf"
FAVICON_OUTPUT="../public/favicon.ico"
convert -density 10080 "$FAVICON_INPUT" \
      -gravity center -background none \
      \( -clone 0 -resize 16x16 -extent 16x16 \) \
      \( -clone 0 -resize 32x32 -extent 32x32 \) \
      \( -clone 0 -resize 48x48 -extent 48x48 \) \
      \( -clone 0 -resize 64x64 -extent 64x64 \) \
      -delete 0 -alpha background -colors 256 "$FAVICON_OUTPUT"
