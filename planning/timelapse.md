# Timelapse 

Quiero que ahora hagamos un timelapse. Se tiene que comportar exactamente igual a como se comporta el iframe visualmente, solo que vamos a hacer un resumen en 1 minuto de cómo ha evolucionado el voto real (sin blancos y nulos) de cada candidato hasta el momento actual. Al terminar debe loopear. El movimiento debe ser suavizado y estético.

## Ejecucion

Este modo solo se ejecuta localmente, en el liveserver, usando la data que se tiene localmente. No se expone ni se construye con build.

## Cómo hacerlo

Usa la misma infraestructura de iframe. Duplícala y sepárala para trabajarla independientemente sin romper nada más.