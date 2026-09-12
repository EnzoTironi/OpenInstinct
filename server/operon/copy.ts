export const connectCopy =
  "Vou ler sua caixa para mostrar com quem você fala. Não vou mandar e-mail. Não vou alterar a agenda.";

const progressCopy = "Entrando conversas…";

export const offerCopy =
  "Registrar as pessoas com quem você falou nos últimos 30 dias";

export const notAdmittedLabel = "não admitido";

export const arrivedFromEmailLabel = "chegou do e-mail";

export function cardCopy(
  conversations: number,
  people: number,
  companies: number,
  conflicts: number
) {
  return `${String(conversations)} conversas em quarentena, ${String(people)} pessoas, ${String(companies)} empresas, ${String(conflicts)} nomes em conflito.`;
}

export function progressWithPercent(percent: number) {
  return `${progressCopy} ${String(percent)}%`;
}

export function quarantineCardMessage(card: string, digest: string) {
  return `${card}\n\n${digest}\n\n${offerCopy}`;
}
