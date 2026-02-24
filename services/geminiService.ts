
import { GoogleGenAI, Type } from "@google/genai";
import { Expense } from "../types";

// Always use a named parameter and direct process.env.API_KEY as per guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getFinancialInsights = async (expenses: Expense[]) => {
  try {
    const summary = expenses.map(e => ({
      desc: e.description,
      amt: e.amount,
      cat: e.category,
      date: e.date
    })).slice(-15); // Send last 15 for context

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analyze these expenses and provide 3 short, actionable financial tips as a bulleted list. Keep it under 60 words. Expenses: ${JSON.stringify(summary)}`,
      config: {
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    // Directly access .text property from GenerateContentResponse
    return response.text || "No insights available yet. Keep tracking your expenses!";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Start recording more expenses to get personalized AI financial coaching.";
  }
};
