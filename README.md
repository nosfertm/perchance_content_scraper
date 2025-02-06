# Perchance Character Scraper  

This is a web scraper that collects characters shared in the comment section of **Perchance** to populate our [public gallery](https://nosfertm.github.io/perchance-character-database/acc-characters.html).  

## ✨ How It Works  

- The scraper scans Perchance's comment sections and extracts character links.  
- All collected characters are processed and filtered.
- Characters that pass the filter are displayed in the **[Gallery](https://nosfertm.github.io/perchance-character-database/acc-characters.html).**.
- Characters that DON'T pass the filter are **discarded**.
- **Credits are always preserved**, including the original username, nickname, or user ID.  

## ❌ Content Removal  

If you want your character removed from the gallery, **open an issue [here](https://github.com/nosfertm/perchance-character-database/issues/new?template=report-content.yaml)**  

We will process removal requests as soon as possible.  

## 🔄 Opting Out  

Since the characters are shared in a public space, we assume there is no issue in making them available to others.  

However, if you **do not** want your character to be collected by the scraper, **include `NOSCRAPE` in your comment**, like this:  

```
Here's my character https://perchance.org/ai-character-chat?data=My_Character~123456789.gz. NOSCRAPE
```

The scraper will **automatically ignore** any comment containing `NOSCRAPE`.  

## 🛠️ Disclaimer  

This tool is meant for **archival and sharing** purposes only. We respect the creators' rights and will comply with any legitimate removal requests.  

If you have any concerns, feel free to reach out via the **[Issues](https://github.com/nosfertm/perchance-character-database/issues)**. 
