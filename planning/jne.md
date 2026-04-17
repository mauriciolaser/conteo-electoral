# JNE

## Necesidad

Necesito obtener el total de votos pendientes (en actas observadas 'H' o con envio al JNE 'E').

## Guía

Sugiero:

En la vista /main/presidenciales:

1. Obtener la cantidad total de mesas/actas:

https://resultadoelectoral.onpe.gob.pe/presentacion-backend/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_01&idUbigeoDepartamento=020000

2. Luego la cantidad de actas enviadas al JEE:

        "enviadasJee": 246,

3. Luego la cantidad de actas pendientes:

        "pendientesJee": 11,

4. Luego la cantidad de votantes:

        "totalVotosEmitidos": 646162,

4. Luego, usando la cantidad de votantes por región, quiero que generes una entrada en el summary que añada a la información de la región, la cantidad de votos "pendientes de contar" y los votos "en revisión JNE".