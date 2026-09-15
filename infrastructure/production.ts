/** Physical identities are pinned so losing state can never create an empty replacement database. */
export const production = {
  region: "gru",
  organization: "enzo-tironi-287",
  hostname: "zoen.tironi.xyz",
  database: {
    app: "companion-pg-prod",
    machine: "48e7799a470d28",
    name: "postgres",
    volume: "vol_re1kyz6p1q5el734",
    volumeName: "pgdata",
    sizeGb: 10,
  },
  web: {
    app: "companion-tironi",
    legacyMachine: "683d14eefe9778",
    name: "zoen-web",
    authVolume: "vol_40o00zpwel2plln4",
  },
  memory: {
    app: "zoen-memory-tironi",
    machine: "d891e765b36648",
    name: "little-meadow-4451",
    volume: "vol_vxmgy7q1kj6yogz4",
    volumeName: "zoen_memory_data",
    sizeGb: 3,
  },
  matrix: { app: "zoen-matrix-tironi" },
  whatsapp: { app: "zoen-whatsapp-tironi" },
  vaultwarden: { app: "zoen-vault-tironi", hostname: "vault.zoen.tironi.xyz" },
} as const;
