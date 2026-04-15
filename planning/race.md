# Plan - Race

Vamos a crear un panel con un pequeño snippet animado. Este snippet consume la información de la página y muestra quién va primero y segundo en una carrera animada. El contenedor tiene como fondo el archivo track.png. 

Se debe copiar en el build a la carpeta /dist como iframe con su contenido.

## Características

El elemento /race tiene un fondo, track.png y encima, se renderiza las animaciones porky-sheet y sanchez-sheet. El que va adelante en votos se dibuja más adelante y más próximo.

## Recarga

Cuando se actualiza la información en la página se actualiza el elemento con la información. Su nivel de proximidad en porcentaje electoral actual de votos válidos es lo que denota proximidad. Como están muy pegados en votos, necesito que ese porcentaje se estire para cubrir un 2% de diferencia como máximo.

## Test

Necesito que en modo development se genere este snippet con información dummy, tomando en cuenta los raw_region_results.json