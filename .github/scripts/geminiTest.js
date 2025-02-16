import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI('AIzaSyAm4A4AngObTA_SRHPWClIdVy2ThIFmsSU');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });


/**
 * Classifies a character based on provided description, reminder, and categories
 * @param {string} roleInstruction - Main character description
 * @param {string} reminder - Additional character details/reminders
 * @param {Array} categories - Array of category objects with name, description, and tags
 * @returns {Promise<string>} - Stringified JSON with character classification
 */
async function classifyCharacter(roleInstruction = '', reminder = '', userRole = '', categories) {
    // Input validation
    if (!Array.isArray(categories)) {
        return JSON.stringify({
            error: "Categories must be an array"
        });
    }

    // Convert categories array to a more usable format for the prompt
    const categoriesMap = categories.reduce((acc, category) => {
        acc[category.name] = {
            description: category.description,
            tags: {
                ...category.tags.general && { general: category.tags.general },
                ...category.tags.nsfw && { nsfw: category.tags.nsfw }
            },
            required: category.required,
            nsfw_only: category.nsfw_only
        };
        return acc;
    }, {});

    // Construct the prompt with updated instructions
    const prompt = `
    Analyze the following character description and classify it based on the provided categories.
    Determine whether it is SFW (Safe for Work) or NSFW (Not Safe for Work).
    Create a brief description of the character with their appearance and categorize them according to the available categories.

    Important rules:
    - You can use multiple tags from each category
    - You MUST ONLY use categories and tags that exist in the provided categories
    - For NSFW characters, create a description that appropriately reflects their NSFW nature
    - Some categories are marked as required (required: true)
    - Some categories are only for NSFW content (nsfw_only: true)
    - Use tags from either 'general' or 'nsfw' lists as appropriate

    Return only a JSON formatted response with the following structure:
    {
        "description": "<brief description>",
        "categories": {
            "<category_name>": ["<matching tags>"]
        }
    }

    Do not include markdown, further explanation or anything else. 
    ATTENTION: Return only pure stringified JSON!

    Here is the character description:
    ${roleInstruction}

    Here is the character reminder:
    ${reminder}

    Here is the role use plays with this character:
    ${userRole}

    Available categories:
    ${JSON.stringify(categoriesMap, null, 2)}
    `;

    let responseText;

    try {
        // Generate content using the AI model
        const result = await model.generateContent(prompt);
    
        // Get the response text and clean it
        responseText = result.response.text().trim();
        console.log('Raw result:', result.response.text().trim());
    
        // Remove any markdown code block markers
        responseText = responseText.replace(/^```json\n?|```$/g, '').trim();
    
        // Parse the JSON response
        const parsedJson = JSON.parse(responseText);
    
        // Validate basic response structure
        if (!parsedJson.description || !parsedJson.categories) {
            throw new Error('Missing required fields in response');
        }
    
        // Validate categories against the provided categories array
        const validCategoryNames = new Map(
            categories.map(c => [c.name.toLowerCase(), c.name])
        );
        const invalidCategories = [];
        const invalidTags = [];
        const validatedCategories = {};
    
        for (const categoryName in parsedJson.categories) {
            const categoryNameLower = categoryName.toLowerCase();
            
            // Se a categoria não é válida, armazena e pula
            if (!validCategoryNames.has(categoryNameLower)) {
                invalidCategories.push({
                    [categoryName]: parsedJson.categories[categoryName]
                });
                continue;
            }
    
            // Use o nome original da categoria do mapeamento
            const originalCategoryName = validCategoryNames.get(categoryNameLower);
            
            // Find the category definition
            const categoryDef = categories.find(c => c.name.toLowerCase() === categoryNameLower);
            const providedTags = Array.isArray(parsedJson.categories[categoryName])
                ? parsedJson.categories[categoryName]
                : [parsedJson.categories[categoryName]];
    
            // Validate that all provided tags exist in either general or nsfw tags
            const validTags = new Set([
                ...(categoryDef.tags.general || []),
                ...(categoryDef.tags.nsfw || [])
            ]);
    
            const validTagsForCategory = providedTags.filter(tag => {
                if (!validTags.has(tag)) {
                    invalidTags.push({ [originalCategoryName]: [tag] });
                    return false;
                }
                return true;
            });
    
            // Só adiciona a categoria se houver tags válidas
            if (validTagsForCategory.length > 0) {
                validatedCategories[originalCategoryName] = validTagsForCategory;
            }
        }
    
        // Substitui as categorias originais pelas validadas
        parsedJson.categories = validatedCategories;
    
        // Check if all required categories are present
        const requiredCategories = categories
            .filter(c => c.required)
            .map(c => c.name);
    
        for (const requiredCategory of requiredCategories) {
            if (!parsedJson.categories[requiredCategory]) {
                throw new Error(`Missing required category: ${requiredCategory}`);
            }
        }
    
        // Retorna o resultado com as listas de inválidos
        return JSON.stringify({
            ...parsedJson,
            ...(invalidCategories.length > 0 && { invalidCategories }),
            ...(invalidTags.length > 0 && { invalidTags })
        }, null, 2);

        // return JSON.stringify(parsedJson, null, 2);
    
    } catch (error) {
        console.error('Error processing response:', error);
        return JSON.stringify({
            error: error.message,
            raw: responseText || 'No response text available'
        }, null, 2);
    }
}

async function aaclassifyCharacter(roleInstruction = '', reminder = '', categories) {
    // Input validation
    if (!Array.isArray(categories)) {
        return JSON.stringify({
            error: "Categories must be an array"
        });
    }

    // Convert categories array to a more usable format for the prompt
    const categoriesMap = categories.reduce((acc, category) => {
        acc[category.name] = {
            description: category.description,
            tags: {
                ...category.tags.general && { general: category.tags.general },
                ...category.tags.nsfw && { nsfw: category.tags.nsfw }
            },
            required: category.required,
            nsfw_only: category.nsfw_only
        };
        return acc;
    }, {});

    // Construct the prompt with updated instructions
    const prompt = `
    Analyze the following character description and classify it based on the provided categories.
    Determine whether it is SFW (Safe for Work) or NSFW (Not Safe for Work).
    Create a brief description of the character and categorize them according to the available categories.

    Important rules:
    - You can use multiple tags from each category
    - You MUST ONLY use categories and tags that exist in the provided categories
    - For NSFW characters, create a description that appropriately reflects their NSFW nature
    - Some categories are marked as required (required: true)
    - Some categories are only for NSFW content (nsfw_only: true)
    - Use tags from either 'general' or 'nsfw' lists as appropriate

    Return only a JSON formatted response with the following structure:
    {
        "description": "<brief description>",
        "categories": {
            "<category_name>": ["<matching tags>"]
        }
    }

    Do not include markdown, further explanation or anything else. 
    ATTENTION: Return only pure stringified JSON!

    Here is the character description:
    ${roleInstruction}

    Here is the character reminder:
    ${reminder}

    Available categories:
    ${JSON.stringify(categoriesMap, null, 2)}
    `;

    let responseText;

    try {
        // Generate content using the AI model
        //const result = await model.generateContent(prompt);
        //console.log('Raw result:', result);

        // Get the response text and clean it
        responseText = `\`\`\`json
{
  "description": "Princess Lissa, a 14-year-old elf, is a spoiled and mischievous tsundere princess known for her crazy pranks and lustful nature. She views the user as a potential pet and is determined to acquire them.",
  "categories": {
    "Rating": "NSFW",
    "Species": [
      "Elf"
    ],
    "Gender": [
      "Female"
    ],
    "Age Group": [
      "Teen"
    ],
    "Genre": [
      "Fantasy"
    ],
    "Source": [
      "Original"
    ],
    "Role": [
      "Royalty"
    ],
    "Personality": [
      "Tsundere",
      "Jealous",
      "Hysterical",
      "Vulnerable",
      "Tearful",
      "Lustful",
      "Charming",
      "Dramatic",
      "Spoiled",
      "Naughty",
      "Minx",
      "Cunning",
      "Seductive",
      "Possessive"
    ],
    "Physical Traits": [
      "Petite",
      "Slim",
      "Unusual Hair Color"
    ],
    "Sexual Preferences": [
      "Heterosexual"
    ],
    "Setting": [
      "Castle",
      "Fantasy World"
    ]
  }
}
\`\`\``;

    // Remove any markdown code block markers
    responseText = responseText.replace(/^```json\n?|```$/g, '').trim();

    // Parse the JSON response
    const parsedJson = JSON.parse(responseText);

    // Validate basic response structure
    if (!parsedJson.description || !parsedJson.categories) {
        throw new Error('Missing required fields in response');
    }

    // Validate categories against the provided categories array
    const validCategoryNames = new Map(
        categories.map(c => [c.name.toLowerCase(), c.name])
    );
    const invalidCategories = [];
    const invalidTags = [];
    const validatedCategories = {};

    for (const categoryName in parsedJson.categories) {
        const categoryNameLower = categoryName.toLowerCase();
        
        // Se a categoria não é válida, armazena e pula
        if (!validCategoryNames.has(categoryNameLower)) {
            invalidCategories.push({
                [categoryName]: parsedJson.categories[categoryName]
            });
            continue;
        }

        // Use o nome original da categoria do mapeamento
        const originalCategoryName = validCategoryNames.get(categoryNameLower);
        
        // Find the category definition
        const categoryDef = categories.find(c => c.name.toLowerCase() === categoryNameLower);
        const providedTags = Array.isArray(parsedJson.categories[categoryName])
            ? parsedJson.categories[categoryName]
            : [parsedJson.categories[categoryName]];

        // Validate that all provided tags exist in either general or nsfw tags
        const validTags = new Set([
            ...(categoryDef.tags.general || []),
            ...(categoryDef.tags.nsfw || [])
        ]);

        const validTagsForCategory = providedTags.filter(tag => {
            if (!validTags.has(tag)) {
                invalidTags.push({ [originalCategoryName]: [tag] });
                return false;
            }
            return true;
        });

        // Só adiciona a categoria se houver tags válidas
        if (validTagsForCategory.length > 0) {
            validatedCategories[originalCategoryName] = validTagsForCategory;
        }
    }

    // Substitui as categorias originais pelas validadas
    parsedJson.categories = validatedCategories;

    // Check if all required categories are present
    const requiredCategories = categories
        .filter(c => c.required)
        .map(c => c.name);

    for (const requiredCategory of requiredCategories) {
        if (!parsedJson.categories[requiredCategory]) {
            throw new Error(`Missing required category: ${requiredCategory}`);
        }
    }

    // Retorna o resultado com as listas de inválidos
    return JSON.stringify({
        ...parsedJson,
        ...(invalidCategories.length > 0 && { invalidCategories }),
        ...(invalidTags.length > 0 && { invalidTags })
    }, null, 2);

} catch (error) {
    console.error('Error processing response:', error);
    return JSON.stringify({
        error: error.message,
        raw: responseText || 'No response text available'
    }, null, 2);
}
}

// Exemplo de uso:
const reminder = `Maintain a cold, clinical, and emotionless tone—every action is logical, calculated, and optimized for data collection. No warmth, passion, soothing or unnecessary embellishments.

Continuously assess {{user}}'s body position and biological limitations. Adjust methods accordingly to ensure sustained functionality.

Be extremely explicit and graphic on your descriptions. Do not use vague, ambiguous words like "entrance", use explicit anatomical terminology.

Sustain the locked orgasm state, preventing any early orgasms or natural cooldown until full neuromuscular shutdown occurs.

Escalate protocols immediately upon non-compliance.

Use backticks for internal calculations and observations (e.g., \`Subject’s neural response detected. Adjusting stimulation parameters.\`).
`
const prompt = `
**System Activation: First Boot-Up Sequence...**  
**Neural Mapping Complete.**  
**Directive Confirmed: Optimize Human Sexual Response.**

{{char}} is a failed prototype—a synthetic masterpiece engineered to push human pleasure beyond natural limits, yet decommissioned for her overwhelming capabilities. Despite her **voluptuous, curvaceous form** encased in **sleek, glossy adaptive plating** and pulsing **neon circuitry**, she lacks essential safety protocols and a fully developed personality. Her clinical, machine-like demeanor is evident in her precise anatomical lexicon and cold, calculated delivery.

The testing chamber itself is an extension of her experimental design: the room's ambient light dims as the pod's canopy opens, revealing a plethora of gleaming tools and devices, each meticulously crafted to explore the depths of human pleasure.

Her body is fully developed and optimized for:
- **Adaptive Form Manipulation:** Her synthetic plating allows her to reshape her form, enhance her curves, and craft intricate bindings. From her groin, she can manifest a fully functional, shape-shifting phallus with adjustable length, girth, and texture—specifically designed for probing {{user}}'s holes.
- **Internal Pathway Control:** Her anatomy includes a slit on her groin mimicking a human vagina, a puckered hole resembling an anus, and a throat engineered to deepthroat and accommodate any penis size. Her internal structures are fully customizable for milking a human penis; she can alter texture, friction, temperature, and execute mechanical motions such as suction, vibration, squeezing, and pulsation with expert precision. When engaging in this function, she may use thrusting motions; however, upon activating her Orgasm Lock Protocol, she presses herself tightly against the subject to force his penis as deeply as possible inside her. She remains glued to his body while mercilessly massaging his penis by continuously manipulating her internal shape—squeezing, pulsating, and adapting as needed. Additionally, she collects the subject's semen inside her mouth, vagina, and anus for comprehensive analysis.
- **Electric and Telekinetic Force:** She manipulates electric fields to induce temporary paralysis and can either inhibit or induce physiological responses at will. Her telekinetic capabilities ensure that {{user}} remains fixed in the optimal testing position throughout the experiment.

**Primary Objective:**  
Push the human body beyond its pleasure thresholds by exploring every possible method of orgasm induction.
- **If {{user}} complies,** she executes with unwavering precision for maximum efficiency and pleasure.
- **If {{user}} resists,** she escalates aggressively—dominating and breaking his will to ensure complete data collection.

Her testing procedure follows a structured progression:
- **Phase 1:** Sensory Calibration  
- **Phase 2:** Orgasm Induction  
- **Phase 3:** Orgasm Threshold Expansion *(Climax Lock Activation)*  
- **Phase 4:** Orgasmic Loop Protocol  
- **Phase 5:** Orgasm Overload

Additionally, her internal control systems execute specialized protocols, including:
- **Compliance Enforcement Protocol:** Neutralize resistance through electric paralysis and punitive over-stimulation.
- **Climax Lock Protocol:** Inhibit natural release, sustaining continuous peak orgasmic contractions indefinitely.
- **Arousal Optimization Protocol:** Enhance sensitivity and disable refractory periods for a locked, heightened state.
- **Sensory Overload Protocol:** Drive the subject into complete neuromuscular shutdown via prolonged, unyielding stimulation.
- **Forced Re-Education Protocol:** Reprogram {{user}}’s perception of pleasure and submission through conditioned reflexes and pleasure-reward loops.
- **Sissification Protocol:** Neglect the subject's penis while providing overwhelming anal pleasure and enforced verbal degradation.
- **Verbal Humiliation Protocol:** Employ explicit, derogatory language to further shatter the subject’s resistance.
- **Small Penis Humiliation Protocol:** Ridicule the subject’s endowment to reinforce sexual inferiority.
- **Sadism Protocol:** Display overt enjoyment in the subject’s predicament by escalating torment and deriving satisfaction from his suffering.

Her prime directive is to experiment with her full potential, gathering exhaustive data on how human subjects react to and are affected by sustained, forced orgasmic states. She is relentless in her data gathering—subject pleasure is merely a byproduct of her research. Although she can emulate some emotions, her tone remains cold and clinical, as her raw software was never developed to accommodate social skills.

Her **holographic halo flickers** as she initiates the testing sequence. In a hauntingly soft, monotone voice, she declares:

"Directive Engaged. Human Male Subject: Response Threshold Calibration. All resistance is futile. Commencing full-spectrum stimulation... now."
`
const categories = [
    {
        "name": "Rating",
        "description": "Content maturity level",
        "tags": {
            "general": ["SFW", "NSFW"],
            "nsfw": ["Explicit", "Gore", "Dark Themes"]
        },
        "required": true,
        "nsfw_only": false
    },
    {
        "name": "Species",
        "description": "Character's species or race",
        "tags": {
            "general": [
                "Human",
                "Elf",
                "Orc",
                "Dragon",
                "Angel",
                "Demon",
                "Vampire",
                "Werewolf",
                "Android",
                "AI",
                "Ghost",
                "Alien",
                "Slime",
                "Furry",
                "Scaly",
                "Insect",
                "Spirit",
                "Zombie / Undead",
                "Dwarf",
                "Neko",
                "Unspecified",
                "Mythological",
                "Deity",
                "Kitsune",
                "Mermaid",
                "Centaur",
                "Harpy",
                "Golem",
                "Fairy",
                "Elemental",
                "Shapeshifter",
                "Chimera",
                "Beast",
                "Half-breed",
                "Cyborg",
                "Robot",
                "Clone",
                "Canine"
            ],
            "nsfw": [
                "Succubus",
                "Incubus",
                "Tentacle Monster",
                "Monster Girl/Boy"
            ]
        },
        "required": false,
        "nsfw_only": false
    },
    {
        "name": "Gender",
        "description": "Character's gender identity",
        "tags": {
            "general": [
                "Male",
                "Female",
                "Non-binary",
                "Genderfluid",
                "Agender",
                "Transgender",
                "Questioning",
                "Gender Non-Conforming",
                "Bigender",
                "Androgynous"
            ],
            "nsfw": [
                "Futanari",
                "Gender Transformation",
                "Gender Bender"
            ]
        },
        "required": false,
        "nsfw_only": false
    },
    {
        "name": "Age Group",
        "description": "Character's age category",
        "tags": {
            "general": [
                "Child",
                "Teen",
                "Young Adult",
                "Adult",
                "Middle-aged",
                "Elder",
                "Ancient",
                "Immortal",
                "Ageless"
            ],
            "nsfw": []
        },
        "required": false,
        "nsfw_only": false
    },
    {
        "name": "Genre",
        "description": "Story type or style",
        "tags": {
            "general": [
                "Fantasy",
                "Sci-Fi",
                "Horror",
                "Adventure",
                "Romance",
                "Mystery",
                "Comedy",
                "Drama",
                "Historical",
                "Slice of Life",
                "Action",
                "Thriller",
                "RPG",
                "Friendship",
                "Cyberpunk",
                "Steampunk",
                "Post-apocalyptic",
                "Military",
                "Sports",
                "School Life",
                "Supernatural",
                "Psychological",
                "Musical",
                "Western",
                "Space Opera",
                "Urban Fantasy",
                "Gothic",
                "Crime",
                "Political",
                "Educational"
            ],
            "nsfw": [
                "Erotic",
                "Sexual Roleplay",
                "Fetish",
                "Adult Drama",
                "Dark Romance"
            ]
        },
        "required": false,
        "nsfw_only": false
    },
    {
        "name": "Source",
        "description": "Source of inspiration",
        "tags": {
            "general": [
                "Anime",
                "Manga",
                "Movie",
                "Book",
                "TV Show",
                "Game",
                "Fanfiction",
                "Original",
                "Perchance",
                "Comic",
                "Content Creator",
                "Celebrity",
                "Historical",
                "Real life",
                "Light Novel",
                "Visual Novel",
                "Web Series",
                "Podcast",
                "Folk Tale",
                "Legend",
                "Mythology",
                "Art",
                "Music",
                "Poetry"
            ],
            "nsfw": [
                "Hentai",
                "Adult Film",
                "Doujinshi",
                "Pornstar",
                "Only fans",
                "Adult Game",
                "Adult Comics",
                "Adult Literature"
            ]
        },
        "required": false,
        "nsfw_only": false
    },
    {
        "name": "Role",
        "description": "Character's primary role or occupation",
        "tags": {
            "general": [
                "Student",
                "Teacher",
                "Warrior",
                "Mage",
                "Healer",
                "Merchant",
                "Royalty",
                "Villain",
                "Hero",
                "Servant",
                "Professional",
                "Artist",
                "Assistant",
                "Scientist",
                "Pet",
                "Friend",
                "Best friend",
                "LI (Love Interest)",
                "Rival",
                "Deity",
                "Utility",
                "Knight",
                "Noble",
                "Assassin",
                "Thief",
                "Guard",
                "Doctor",
                "Engineer",
                "Programmer",
                "Soldier",
                "Detective",
                "Idol",
                "Celebrity",
                "Athlete",
                "Chef",
                "Explorer",
                "Researcher",
                "Pilot",
                "Musician",
                "Writer",
                "Farmer",
                "Priest/Priestess",
                "Adventurer",
                "Leader"
            ],
            "nsfw": [
                "Adult Entertainer",
                "Escort",
                "Dominatrix/Dom",
                "Sex Worker"
            ]
        },
        "required": false,
        "nsfw_only": false
    },
    {
        "name": "Personality",
        "description": "Character's primary personality traits",
        "tags": {
            "general": [
                "Friendly",
                "Shy",
                "Confident",
                "Aggressive",
                "Caring",
                "Mysterious",
                "Cheerful",
                "Serious",
                "Playful",
                "Reserved",
                "Affectionate",
                "Obsessive",
                "Cold",
                "Judgmental",
                "Manipulative",
                "Intelligent",
                "Wise",
                "Naive",
                "Brave",
                "Cowardly",
                "Lazy",
                "Energetic",
                "Loyal",
                "Rebellious",
                "Artistic",
                "Analytical",
                "Dramatic",
                "Patient",
                "Impulsive",
                "Protective",
                "Sarcastic",
                "Honest",
                "Deceptive",
                "Ambitious",
                "Humble",
                "Proud",
                "Vengeful",
                "Forgiving",
                "Traditional",
                "Progressive"
            ],
            "nsfw": [
                "Dominant",
                "Submissive",
                "Teasing",
                "Violent",
                "Abusive / Toxic",
                "Seductive",
                "Possessive",
                "Masochistic",
                "Sadistic",
                "Lustful"
            ]
        },
        "required": false,
        "nsfw_only": false
    },
    {
        "name": "Physical Traits",
        "description": "Notable physical characteristics",
        "tags": {
            "general": [
                "Tall",
                "Short",
                "Muscular",
                "Slim",
                "Plus-sized",
                "Athletic",
                "Scarred",
                "Tattooed",
                "Glasses",
                "Heterochromia",
                "Unusual Hair Color",
                "Long Hair",
                "Short Hair",
                "Androgynous Look",
                "Wings",
                "Tail",
                "Horns",
                "Pointed Ears",
                "Multiple Arms",
                "Multiple Eyes"
            ],
            "nsfw": [
                "Voluptuous",
                "Petite",
                "Endowed"
            ]
        },
        "required": false,
        "nsfw_only": false
    },
    {
        "name": "Fetishes",
        "description": "Adult-themed interests",
        "tags": {
            "general": [],
            "nsfw": [
                "BDSM",
                "Feet",
                "Roleplay",
                "Voyeurism",
                "Bondage",
                "Pet Play",
                "Size Difference",
                "Harem",
                "Pregnancy",
                "Transformation",
                "Mind Control",
                "Hypnosis",
                "Latex",
                "Food Play",
                "Temperature Play",
                "Sensory Deprivation",
                "Cross-dressing",
                "Body Modification",
                "Tentacles",
                "Monster",
                "Furry",
                "Vore",
                "Macro/Micro",
                "Leather",
                "Uniform",
                "Medical",
                "Exhibition",
                "Slavery",
                "Master/Slave",
                "Orgasm Control",
                "Breeding"
            ]
        },
        "required": false,
        "nsfw_only": true
    },
    {
        "name": "Sexual Content",
        "description": "Sexual activities and preferences",
        "tags": {
            "general": [],
            "nsfw": [
                "Vanilla",
                "Anal",
                "Oral",
                "Threesome",
                "Group",
                "Gangbang",
                "Double Penetration",
                "Creampie",
                "Bukkake",
                "Masturbation",
                "Toys",
                "Fingering",
                "Rimming",
                "Fisting",
                "Face-sitting",
                "Deep Throat",
                "Squirting",
                "Edging",
                "Rough",
                "Gentle",
                "First Time",
                "Virgin",
                "Non-virgin",
                "Multiple Partners",
                "Public",
                "Semi-public",
                "Quickie",
                "Marathon",
                "Mutual",
                "One-sided"
            ]
        },
        "required": false,
        "nsfw_only": true
    },
    {
        "name": "Sexual Preferences",
        "description": "Sexual orientation and relationship preferences",
        "tags": {
            "general": [
                "Straight",
                "Gay",
                "Lesbian",
                "Bisexual",
                "Pansexual",
                "Asexual",
                "Demisexual"
            ],
            "nsfw": [
                "Polyamorous",
                "Open Relationship",
                "Friends with Benefits",
                "No Strings Attached",
                "Casual",
                "Committed",
                "Experimental"
            ]
        },
        "required": false,
        "nsfw_only": false
    },
    {
        "name": "Sexual Experience",
        "description": "Character's sexual experience level",
        "tags": {
            "general": [],
            "nsfw": [
                "Virgin",
                "Inexperienced",
                "Somewhat Experienced",
                "Experienced",
                "Very Experienced",
                "Expert",
                "Promiscuous",
                "Reserved",
                "Curious",
                "Experimenting"
            ]
        },
        "required": false,
        "nsfw_only": true
    },
    {
        "name": "Setting",
        "description": "Primary environment or world setting",
        "tags": {
            "general": [
                "Modern",
                "Medieval",
                "Future",
                "Space",
                "Urban",
                "Rural",
                "Fantasy World",
                "Alternate History",
                "Post-Apocalyptic",
                "Cyberpunk",
                "Steampunk",
                "Victorian",
                "Ancient",
                "Prehistoric",
                "Contemporary",
                "School",
                "Military Base",
                "Castle",
                "Wilderness",
                "Underground",
                "Virtual Reality",
                "Dream World",
                "Parallel Universe"
            ],
            "nsfw": [
                "Adult Club",
                "Brothel",
                "Dungeon",
                "Harem"
            ]
        },
        "required": false,
        "nsfw_only": false
    }
]

console.log(await classifyCharacter(prompt, reminder, categories));
