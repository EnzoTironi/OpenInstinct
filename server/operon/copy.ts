export const connectCopy =
  "Vou ler sua caixa para mostrar com quem você fala. Não vou mandar e-mail. Não vou alterar a agenda.";

export const progressCopy = "Entrando conversas…";

export const offerCopy =
  "Registrar as pessoas com quem você falou nos últimos 30 dias";

export const notAdmittedLabel = "não admitido";

export const arrivedFromEmailLabel = "chegou do e-mail";

export const builderOffCopy =
  "Admissão desligada. O Builder Operon está desligado por padrão.";

export const gmailGatewaySeamCopy =
  "Gmail do gateway é um adaptador nomeado. Ainda não está ligado.";

export const imapSeamCopy = "IMAP local ainda não está ligado.";

export const emptyMailboxCopy = "Caixa vazia.";

export const invalidMailboxCopy = "Caixa inválida.";

export const typeBudget = [
  "Pessoa",
  "Organização",
  "Conversa",
  "Compromisso",
] as const;

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
