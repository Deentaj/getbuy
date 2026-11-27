export type SupportChatFaqReply = {
  answer: string;
  handoff: boolean;
};

const faqEntries: Array<{ matches: RegExp; answer: string }> = [
  {
    matches: /\b(order status|track(?:ing)? (?:my )?order|where is my order|delivery status)\b/,
    answer: 'Open Orders in the GetBuy app to see the latest update from the seller or delivery partner. If the status looks wrong, send your order number and a customer service teammate can help.',
  },
  {
    matches: /\b(change|update|edit).{0,30}\b(address|location)\b|\b(delivery|shipping) address\b/,
    answer: 'You can update your saved address in your profile before placing an order. For an order already placed, send your order number here and customer service can advise you.',
  },
  {
    matches: /\b(refund|money back|reimburse(?:ment)?)\b/,
    answer: 'Refund options depend on the order and its payment status. Send your order number and a customer service teammate will review your request.',
  },
];

export function getSupportChatFaqReply(question: string): SupportChatFaqReply {
  const normalized = question.toLowerCase().replace(/\s+/g, ' ').trim();
  const entry = faqEntries.find((candidate) => candidate.matches.test(normalized));
  if (entry) return { answer: entry.answer, handoff: false };

  return {
    answer: 'I could not find a matching answer in the help guide. A customer service teammate will follow up here. Please include your order number if your question is about an order.',
    handoff: true,
  };
}
