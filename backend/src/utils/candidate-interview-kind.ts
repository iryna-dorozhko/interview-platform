export const SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME = "Моя анкета";

export function isSelfServiceQuestionnaire(displayName: string): boolean {
  return displayName === SELF_SERVICE_QUESTIONNAIRE_DISPLAY_NAME;
}
