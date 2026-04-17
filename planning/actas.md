# Actas

Vamos a obtener el total de votos que están siendo disputado en actas impugnadas. Eso se obtiene de la data que responde la ONPE. Quiero que estos votos se muestren en los paneles:

Interpolación de votos de Roberto Sánchez (Juntos por el Perú)

y 

Interpolación de votos de Rafael López Aliaga (Renovación Popular)

En ambas quiero que pongas una nueva columna a la derecha de PROYECCION VOTO RURAL donde tengamos ACTAS JEE

## ACTAS JEE

Estas actas tienen un número de votantes en disputa; se debe restar en cada región del número de votantes pendientes.

Se tienen que scrappear y mostrar en la API durante el summary. 

Se usa el patrón de ruta que revisión de la API mediante playwright, pero con el patrón visto en departamentos, departamentos-extranjero, provincia.md, distrito.md, locales.md e impugnadas.md

Estas actas JEE deben mostrarse con color amarillo.

## Tarea

1. Crear una rutina para scrappear esta data de la página usando una aproximación similar a la que actualmente se usa. 