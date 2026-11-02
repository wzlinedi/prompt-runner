// Ready-made values: prompts, endpoint, parameters JSON, and a sample dataset.
// Platform-specific facts live here and in chat.mjs only (specs/001-simple-prompt-runner/references/).

export const DEFAULT_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

export const DEFAULT_MAIN_PROMPT = 'Summarize below data.\n\nHighlight key points and ignore less important.\n\n{prompt_input}';

export const DEFAULT_MAIN_JSON = {
  model: 'nvidia/nemotron-3.5-bolt-e4b',
  temperature: 1,
  top_p: 0.95,
  max_tokens: 4096,
  seed: 42,
  chat_template_kwargs: { enable_thinking: true },
};

export const DEFAULT_JUDGE_JSON = {
  model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  temperature: 1,
  top_p: 0.95,
  max_tokens: 16384,
  reasoning_budget: 16384,
  chat_template_kwargs: { enable_thinking: true },
};

/** The JSON object as the text shown in a parameters field. */
export const jsonText = (object) => JSON.stringify(object, null, 2);

export const DEFAULT_ACCURACY_PROMPT = `You are a meticulous QA reviewer. Check the ACCURACY of a model's output against the source data it was given.

SOURCE DATA (the only ground truth):
{prompt_input}

MODEL OUTPUT:
{output}

Instructions:
1. Extract every verifiable fact from the MODEL OUTPUT: numbers, percentages, dates, names, comparisons and trends (for example "high", "low", "rising").
2. Check each fact against the SOURCE DATA only. Do not use outside knowledge.
3. Give each fact one verdict:
   - CORRECT: matches the source (rounding is acceptable, for example 36.5 million for 36 497 495);
   - INCORRECT: contradicts the source, or mixes up a value, unit or period (state the correct value);
   - UNSUPPORTED: not found in the source.
4. Judge qualitative wording by whether it is a fair reading of the numbers.
5. Do not penalise facts that are missing from the output; omissions are not accuracy errors.

Report:
- A list of the facts checked, each with its verdict and the matching source value.
- An overall accuracy percentage: CORRECT facts divided by all facts checked, times 100.
- One or two sentences on the main problems, if any.`;

export const DEFAULT_COMPLETENESS_PROMPT = `You are a meticulous QA reviewer. Check the COMPLETENESS of a model's output: how much of the source data it covers.

SOURCE DATA:
{prompt_input}

MODEL OUTPUT:
{output}

Instructions:
1. List every distinct fact in the SOURCE DATA; each indicator with its value counts as one fact.
2. For each fact, check whether the MODEL OUTPUT mentions it with the same value (rounding is acceptable).
3. Mark each fact PRESENT or MISSING. If a fact is mentioned with a wrong value, mark it PRESENT and add a short note; accuracy is judged separately.
4. Do not judge style, length or the wording of the output.

Report:
- A list of the facts that appear in the output (PRESENT).
- A list of the facts that do not appear (MISSING).
- An overall completeness percentage: PRESENT facts divided by all facts in the source, times 100.`;

// ---- Sample dataset: the Eurostat "Selected indicators" format, one row per country ----
// Poland: real data from the user's example. Other countries: INVENTED example values (not Eurostat data).
const INDICATORS = [
  ['Population on 1 January', '(absolute number)', '2025'],
  ['Youth population (15 - 29 years)', '(as percentage of the total population)', '2025'],
  ['First time asylum applicants', '(absolute number)', '2025'],
  ['Gender pay gap', '(as percentage of average gross hourly earnings of men; unadjusted)', '2024'],
  ['Minimum wage', '(Euro per month)', '2026-S1'],
  ['People at risk of poverty or social exclusion', '(as percentage of the population)', '2025'],
  ['Early school leavers', '(as percentage of the population aged 18 - 24)', '2025'],
  ['Inflation rate', '(percentage change compared to previous year)', '2025'],
  ['Unemployment rate', '(as percentage of the labour force aged 15 - 74 years)', '2025'],
  ['Youth unemployment rate', '(percentage of labour force aged less than 25)', '2025'],
  ['GDP per capita', '(Euro per inhabitant)', '2025'],
  ['Government gross debt', '(as percentage of GDP)', '2025'],
  ['Government deficit / surplus', '(as percentage of GDP)', '2025'],
  ['Greenhouse gas emissions', '(Tonnes per capita)', '2024'],
  ['Renewable energy', '(as percentage in gross final energy consumption)', '2025'],
  ['Electricity prices', '(Euro per MWh, incl. taxes)', '2025-S1'],
  ['Energy imports dependency', '(percentage of gross available energy)', '2024'],
  ['Recycling rate of municipal waste', '(percentage of total municipal waste)', '2024'],
];

const countryTable = (name, values) => `Selected indicators\t${name}\tSource dataset\n${INDICATORS
  .map(([indicator, unit, period], i) => `${indicator}\n${unit}\t${values[i]}\n(${period})\tView source data`).join('\n')}`;

const VALUES = {
  PL: ['36 497 495', '15.4%', '11 155', '4.0%', '1 139€', '15.0%', '4.0%', '3.3%', '3.1%', '12.2%', '17 210€', '59.6%', '-7.2%', '9.3', '18.7%', '255.9€', '45.7%', '31.1%'],
  CZ: ['10 900 000', '17.2%', '5 400', '11.8%', '826€', '12.0%', '6.0%', '2.5%', '2.7%', '9.0%', '22 800€', '43.0%', '-2.0%', '10.5', '19.0%', '210.0€', '36.0%', '38.0%'],
  SK: ['5 400 000', '16.0%', '400', '15.0%', '750€', '16.5%', '7.0%', '3.6%', '5.2%', '19.0%', '18 500€', '60.0%', '-5.0%', '7.0', '17.0%', '230.0€', '60.0%', '45.0%'],
  HU: ['9 600 000', '15.5%', '30', '9.0%', '700€', '18.0%', '10.0%', '4.5%', '4.4%', '12.0%', '15 500€', '73.0%', '-5.0%', '5.5', '15.0%', '280.0€', '55.0%', '40.0%'],
  DE: ['83 500 000', '16.5%', '230 000', '17.0%', '2 161€', '20.0%', '12.0%', '2.2%', '3.5%', '6.5%', '44 000€', '63.0%', '-2.5%', '8.0', '22.0%', '290.0€', '65.0%', '68.0%'],
};

const SAMPLE_ROWS = [
  ['PL', 'Poland', countryTable('Poland', VALUES.PL), 'Poland has about 36.5 million inhabitants, 15.4% of them aged 15-29. Unemployment is low at 3.1%, but youth unemployment is 12.2%. The minimum wage is 1 139 EUR per month and the gender pay gap is 4.0%. GDP per capita is 17 210 EUR and inflation is 3.3%; government debt is 59.6% of GDP with a deficit of 7.2%. Renewables cover 18.7% of final energy consumption, emissions are 9.3 tonnes per capita and 45.7% of energy is imported.'],
  ['CZ', 'Czechia (example)', countryTable('Czechia', VALUES.CZ), 'Czechia has about 10.9 million inhabitants and low unemployment of 2.7%. The gender pay gap is 11.8% and the minimum wage is 826 EUR per month. GDP per capita is 22 800 EUR, inflation is 2.5%, government debt is 43.0% of GDP with a deficit of 2.0%. Renewables cover 19.0% of final energy consumption.'],
  ['SK', 'Slovakia (example)', countryTable('Slovakia', VALUES.SK), 'Slovakia has about 5.4 million inhabitants. Unemployment is 5.2% and youth unemployment is high at 19.0%. The minimum wage is 750 EUR per month, GDP per capita is 18 500 EUR, inflation is 3.6% and the deficit is 5.0% of GDP with debt at 60.0%. 60.0% of energy is imported.'],
  ['HU', 'Hungary (example, rate limit)', countryTable('Hungary', VALUES.HU), 'Hungary has about 9.6 million inhabitants. Inflation is 4.5%, government debt is 73.0% of GDP with a deficit of 5.0%, and 55.0% of energy is imported.'],
  ['DE', 'Germany (example, no expected result)', countryTable('Germany', VALUES.DE), ''],
];

const quoteCell = (value) => (/[",\n\t]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The sample dataset as comma-separated text with quoting where needed. */
export const SAMPLE_DATASET = ['id,name,prompt_input,expected_result', ...SAMPLE_ROWS.map((row) => row.map(quoteCell).join(','))].join('\n');
