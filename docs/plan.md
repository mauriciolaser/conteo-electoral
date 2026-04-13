# Plan

Padrón total: 27,325,432
Falta procesar: 16,358,290

Necesito hacer una proyección básica a nivel regional y a nivel nacional a partir de resultados parciales que tengo en mi carpeta /data.md

No necesito un proceso estadístico demasiado fiel, solo una proyección informada en diferentes escenarios con un margen de error.

# Tarea
En base a la data disponible, quiero que hagas la proyección de la cantidad de votos finales "si todo sigue así".

Quiero que entres a la página con un script, esperes a que carguen los elementos como se ve en votantes.md y que extraigas la data en .json por regiones. Luego, esa data quiero que la proceses para "completar" con la misma tendencia el resto de los resultados a nivel de cada región y un resultado único nacional y extranjero. 

Construye el scrapper usando node o python, extrae la data, haz el trabajo.

# Source

https://resultadoelectoral.onpe.gob.pe/main/presidenciales

La página es una página en Javascript. Tiene los datos pero son escaneables, pero se renderizan con los request. La forma de la página está en votantes.md
