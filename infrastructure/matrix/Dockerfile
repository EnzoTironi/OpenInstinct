# Unmodified Synapse is a separate AGPL-3.0 service. Source: element-hq/synapse v1.160.0.
FROM matrixdotorg/synapse:v1.160.0@sha256:78de1d10bef02e375f861d1cc99f8bedd9381d4f9083ea8b2c22a053477b205f
COPY configure.py /zoen/configure.py
USER 991:991
ENTRYPOINT ["python", "/zoen/configure.py"]
