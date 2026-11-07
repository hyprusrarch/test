(function () {
  // Extracted from the original Stage 9 ESL project's Unit 5 (Technology), plus
  // a small project-stack identification set based on its actual source files.
  window.ESCAPE_TECH_ARCHIVE = {
    vocabulary: [
      { w: 'develop', def: 'to make or grow something new over time' },
      { w: 'structure', def: 'the way the parts of something are arranged' },
      { w: 'analyse', def: 'to study something in detail to understand it' },
      { w: 'revolution', def: 'a huge change in the way things are done' },
      { w: 'mechanism', def: 'the parts of a machine that work together' },
      { w: 'concept', def: 'an idea' },
      { w: 'evaluate', def: 'to judge how good or useful something is' },
      { w: 'integrate', def: 'to combine things so they work together' },
      { w: 'impact', def: 'a strong effect' },
      { w: 'consequence', def: 'a result of an action, often a bad one' },
      { w: 'innovation', def: 'a new idea, method or invention' },
      { w: 'hypothesis', def: 'an idea that can be tested in an experiment' },
      { w: 'simulation', def: 'a computer model of a real situation' },
      { w: 'synthesis', def: 'combining parts to make something new' },
      { w: 'empirical', def: 'based on experiment and observation, not theory' },
      { w: 'paradigm', def: 'a typical model or way of thinking about something' },
      { w: 'variable', def: 'a factor that can change in an experiment' },
      { w: 'algorithm', def: 'a set of steps a computer follows to solve a problem' },
      { w: 'correlation', def: 'a connection between two things that change together' },
      { w: 'implementation', def: 'putting a plan into action' }
    ],
    projectStack: [
      {
        id: 'html', answer: 'HTML',
        prompt: 'Which technology marks the structure and content of a webpage?',
        opts: ['HTML', 'CSS', 'JavaScript', 'SQL'],
        note: 'HTML is a markup language, not a programming language.'
      },
      {
        id: 'css', answer: 'CSS',
        prompt: 'Which technology controls webpage colours, spacing and layout?',
        opts: ['Python', 'CSS', 'SQL', 'JavaScript'],
        note: 'CSS is a stylesheet language.'
      },
      {
        id: 'javascript', answer: 'JavaScript',
        prompt: 'Which programming language runs the browser game logic and interactions?',
        opts: ['Python', 'JavaScript', 'HTML', 'SQL'],
        note: 'JavaScript powers the browser-side behaviour.'
      },
      {
        id: 'python', answer: 'Python',
        prompt: 'Which language is used by the original ESL repository helper scripts in its tools folder?',
        opts: ['CSS', 'SQL', 'Python', 'HTML'],
        note: 'Python is used for repository tooling scripts.'
      },
      {
        id: 'sql', answer: 'SQL',
        prompt: 'Which language appears in the original ESL project database schema?',
        opts: ['JavaScript', 'HTML', 'SQL', 'Python'],
        note: 'SQL defines and queries relational database structures.'
      }
    ],
    relatedVocabulary: [
      { w: 'problem-solving', def: 'finding ways to deal with difficult situations', note: 'The original Stage 9 project uses the example: “Coding is great for problem-solving skills.”' }
    ],
    grammar: [
      { stem: 'The engineer ___ designed this robot is only 19.', answer: 'who', opts: ['who', 'which', 'whose', 'where'] },
      { stem: 'This is the app ___ helps you learn new words.', answer: 'which', opts: ['which', 'who', 'whose', 'where'] },
      { stem: "She's the student ___ invention won the prize.", answer: 'whose', opts: ['whose', 'who', 'which', 'that'] },
      { stem: 'In 20 years, most cars ___ by computers.', answer: 'will be driven', opts: ['will be driven', 'will drive', 'will be drive', 'are going to drive'] },
      { stem: 'The results ___ on Friday.', answer: 'will be announced', opts: ['will be announced', 'will announced', 'will be announce', 'are announce'] }
    ]
  };
})();
