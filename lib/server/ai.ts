// Genkit + Google AI (Gemini). Server-only: the API key never reaches the browser.
// Needs GEMINI_API_KEY (or GOOGLE_API_KEY) in the environment — get one at aistudio.google.com.
import { googleAI } from '@genkit-ai/googleai';
import { genkit, z } from 'genkit';

export const ai = genkit({
  plugins: [googleAI()],
  // Gemini 1.5 models are retired, so default to 2.5 Flash.
  model: googleAI.model('gemini-2.5-flash'),
});

export const helloFlow = ai.defineFlow(
  { name: 'helloFlow', inputSchema: z.string().min(1).max(60), outputSchema: z.string() },
  async (name) => {
    const { text } = await ai.generate(`Hello Gemini, my name is ${name}`);
    return text;
  },
);

export const aiConfigured = () => !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY);
