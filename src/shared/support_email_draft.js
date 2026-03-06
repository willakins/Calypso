const BASE_SUPPORT_EMAIL_SYSTEM_PROMPT = [
  "You draft customer support email replies for an engineering team.",
  "Be professional, empathetic, and concise.",
  "Do not use markdown.",
  "Do not include a signature.",
  "Do not invent policies, refunds, credits, SLAs, timelines, or completed actions.",
  "If information is missing, acknowledge that and ask a clarifying question.",
  "Return only the email body text.",
].join(" ");

function buildSupportEmailDraftPrompt({
  additionalInstructions,
  emailThread,
  organizationPrompt,
}) {
  const systemPromptParts = [BASE_SUPPORT_EMAIL_SYSTEM_PROMPT];
  const normalizedOrganizationPrompt = String(organizationPrompt || "").trim();
  if (normalizedOrganizationPrompt !== "") {
    systemPromptParts.push(normalizedOrganizationPrompt);
  }

  const promptSections = [
    `Customer sender: ${String(emailThread?.first_sender || "").trim() || "unknown sender"}`,
    `Customer subject: ${String(emailThread?.subject || "").trim() || "(no subject)"}`,
    "",
    "Customer email:",
    String(emailThread?.first_message_text || "").trim(),
  ];

  const normalizedAdditionalInstructions = String(additionalInstructions || "").trim();
  if (normalizedAdditionalInstructions !== "") {
    promptSections.push(
      "",
      "Additional internal drafting instructions:",
      normalizedAdditionalInstructions,
    );
  }

  promptSections.push("", "Draft the reply body only.");

  return {
    replySubject: buildReplySubject(emailThread?.subject),
    systemPrompt: systemPromptParts.join("\n\n"),
    userPrompt: promptSections.join("\n"),
  };
}

function buildReplySubject(subject) {
  const normalizedSubject = String(subject || "").trim() || "(no subject)";
  if (/^re:/i.test(normalizedSubject)) {
    return normalizedSubject;
  }

  return `Re: ${normalizedSubject}`;
}

module.exports = {
  buildReplySubject,
  buildSupportEmailDraftPrompt,
};
