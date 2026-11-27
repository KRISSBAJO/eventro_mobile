/**
 * The organizer's questions at checkout (GET /holds/:id `questions`): the ones asked once, then the ones asked of
 * each ticket. Free text is a field; a choice is a row of chips. Answers are kept by "<question id>:<ticket number>"
 * (no number for a question asked once) and sent with POST /orders.
 */
import { View } from 'react-native';
import type { CheckoutQuestion } from '@/lib/types';
import { colors, space } from '@/theme';
import { Chip, Field, Txt } from './ui';

export type Answers = Record<string, string>;

/** The keys every required question needs an answer under, for an order of `qty` tickets. */
const requiredKeys = (questions: CheckoutQuestion[], qty: number) =>
  questions.filter((q) => q.required).flatMap((q) => (q.per === 'TICKET' ? Array.from({ length: qty }, (_, i) => ({ q, key: `${q.id}:${i}`, ticket: i as number | null })) : [{ q, key: `${q.id}:`, ticket: null as number | null }]));

/** The first required question left unanswered, in words, or ''. */
export function questionProblem(questions: CheckoutQuestion[], answers: Answers, qty: number) {
  const miss = requiredKeys(questions, qty).find((r) => !(answers[r.key] ?? '').trim());
  return miss ? `Please answer “${miss.q.label}”${miss.ticket === null || qty === 1 ? '' : ` for ticket ${miss.ticket + 1}`}.` : '';
}

/** The answers as the API takes them: only the ones given. */
export const answerList = (answers: Answers) =>
  Object.entries(answers)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => {
      const [questionId, n] = k.split(':');
      return { questionId, value: v.trim(), ...(n ? { ticket: Number(n) } : {}) };
    });

export function CheckoutQuestions({ questions, qty, tierName, answers, onChange, showErrors, disabled }: { questions: CheckoutQuestion[]; qty: number; tierName: string; answers: Answers; onChange: (key: string, value: string) => void; showErrors: boolean; disabled?: boolean }) {
  const once = questions.filter((q) => q.per !== 'TICKET');
  const each = questions.filter((q) => q.per === 'TICKET');
  const input = (q: CheckoutQuestion, key: string) => {
    const missing = showErrors && q.required && !(answers[key] ?? '').trim();
    if (q.type === 'CHOICE') {
      return (
        <View key={key} style={{ gap: space.sm }}>
          <Txt variant="smallStrong">
            {q.label}
            {q.required ? '' : ' (optional)'}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {q.options.map((o) => (
              <Chip key={o} label={o} active={answers[key] === o} onPress={() => (disabled ? undefined : onChange(key, answers[key] === o && !q.required ? '' : o))} />
            ))}
          </View>
          {missing ? (
            <Txt variant="small" color={colors.accent}>
              Pick one.
            </Txt>
          ) : null}
        </View>
      );
    }
    return <Field key={key} label={`${q.label}${q.required ? '' : ' (optional)'}`} value={answers[key] ?? ''} onChangeText={(v) => onChange(key, v)} maxLength={200} error={missing ? 'Please answer this.' : ''} editable={!disabled} />;
  };
  return (
    <View style={{ gap: space.lg }}>
      <Txt variant="h3" accessibilityRole="header">
        Questions from the organizer
      </Txt>
      {once.map((q) => input(q, `${q.id}:`))}
      {each.length
        ? Array.from({ length: qty }, (_, i) => (
            <View key={i} style={{ gap: space.md }}>
              <Txt variant="small" color={colors.dim}>
                {`Ticket ${i + 1}${qty > 1 ? ` of ${qty}` : ''} · ${tierName}`}
              </Txt>
              {each.map((q) => input(q, `${q.id}:${i}`))}
            </View>
          ))
        : null}
    </View>
  );
}
