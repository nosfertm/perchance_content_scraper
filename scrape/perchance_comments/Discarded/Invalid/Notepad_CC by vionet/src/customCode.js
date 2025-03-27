/*

Accessing the Notepad
- Send `/np` or `/notepad` to open the window.
- Click the red `x` to close it. 
  If not yet saved, it would prompt you to save and not hide the window.


Creating a Custom New Notepad
1. Specify the notepad name
2. Add content to the textarea
3. Click 'Save'
4. Navigate to your notepad from the dropdown.

*/

window.NotepadCC = {
  toggleDarkMode: function () {
    window.isDarkMode = !JSON.parse(window.isDarkMode);
    if (isDarkMode) {
      window.DarkReader.enable();
      darkModeBtn.innerHTML = '<i class="sun icon"></i>';
    } else {
      window.DarkReader.disable();
      darkModeBtn.innerHTML = '<i class="moon icon"></i>';
    }
    oc.character.customData.darkmode = window.isDarkMode;
  },
  deleteNotepad: function () {
    if (notepadSelect.value == "default") return;
    let status = document.getElementById("status");
    delete oc.character.customData.notepads[notepadSelect.value];
    status.innerHTML = `Deleted '${notepadSelect.value}'.`;
    setTimeout(() => (status.innerHTML = ``), 1000);
    window.NotepadCC.populateNotepadSelect();
    window.NotepadCC.changeNotepad();
  },
  changeNotepad: function () {
    let status = document.getElementById("status");
    if (
      window.savedRecently ||
      oc.character.customData.notepads[notepadSelect.value] == notepad.value
    ) {
      if (!oc.character.customData.notepadSelect)
        oc.character.customData.notepadSelect = notepadSelect.value;
      oc.character.customData.notepadSelect = notepadSelect.value;
      notepad.value = oc.character.customData.notepads[notepadSelect.value];
    } else {
      status.innerHTML = `Changes aren't saved.`;
      window.NotepadCC.populateNotepadSelect();
      setTimeout(() => (status.innerHTML = ``), 1000);
    }
  },
  populateNotepadSelect: function () {
    notepadSelect.innerHTML = Object.keys(oc.character.customData.notepads)
      .map((a) =>
        oc.character.customData.notepadSelect == a
          ? `<option selected>${a}</option>`
          : `<option>${a}</option>`
      )
      .join("");
  },
  notepadSaveToCustomData: async function () {
    let status = document.getElementById("status");
    let text = document.getElementById("notepad").value;
    let nId = document.getElementById("notepadSelect").value;
    let notepads = oc.character.customData.notepads;
    if (
      newNotepadId.value.trim() != "" &&
      !Object.keys(notepads).includes(newNotepadId.value.trim())
    )
      nId = newNotepadId.value.trim();
    if (!notepads[nId]) notepads[nId] = "";
    notepads[nId] = text;
    window.savedRecently = true;
    status.innerHTML = `Saved.`;
    setTimeout(() => (status.innerHTML = ``), 1000);
    oc.character.customData.notepads = notepads;
    window.NotepadCC.populateNotepadSelect();
    window.NotepadCC.changeNotepad();
    newNotepadId.value = "";
  },
  checkIfSavedRecently: async function () {
    let status = document.getElementById("status");
    if (
      window.savedRecently ||
      oc.character.customData.notepads[notepadSelect.value] == notepad.value
    ) {
      oc.window.hide();
    } else {
      status.innerHTML = `Changes aren't saved.`;
      setTimeout(() => (status.innerHTML = ``), 1000);
    }
  },
  setWindowHTML: async function () {
    document.body.innerHTML = `
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/2.5.0/semantic.css" integrity="sha512-6PtWSF1JdejluD9SoAmj/idJKF+dJoa2u9UMldygOhgT4M0dmXTiNUx1TwqNiEg4eIjOb4bZRQ19cOP7p8msYA==" crossorigin="anonymous" referrerpolicy="no-referrer" />
  <main class="ui" style="padding: 1em">
    <section class="ui segment" style="margin: auto">
      <h1>Notepad</h1>
      <span class="ui label top right attached basic" style="border: none" id="status"></span>
      <div class="ui form">
        <div class="ui inline fields">
          <div class="ui field">
            <select id="notepadSelect" onchange="window.NotepadCC.changeNotepad()">
              <option>default</option>
            </select>
            <input id="newNotepadId" placeholder="Custom Notepad Name"/>
          </div>
          <div class="ui" style="display: flex; gap:0.2em;">
            <button class="ui button" onclick="window.NotepadCC.notepadSaveToCustomData()">Save</button>
            <button class="ui button" onclick="window.NotepadCC.deleteNotepad()">Delete</button>
            <button class="ui button icon" title="Toggle Dark Mode" onclick="window.NotepadCC.toggleDarkMode()" id="darkModeBtn"><i class="moon icon"></i></button>
            <button class="ui button red icon" onclick="window.NotepadCC.checkIfSavedRecently()"><i class="close icon"></i></button>
          </div>
        </div>
      </div>
      <div class="ui form">
        <div class="ui field">
          <textarea rows class="ui" id="notepad" oninput="window.savedRecently = false"></textarea>
        </div>
      </div>
    </section>
  </main>


  <style>
  :root {
    color-scheme: light dark;
      font-family: monospace;
  }
    textarea {
        display: block;
        width: 100%;
        font-family: monospace;
        font-size: 0.8em !important;
        max-width: 100%;
        field-sizing: content;
        min-height: 3lh;
        height: 10lh;
        max-height: calc(100dvh - 200px);
      }
  </style>
  `;
    if (!window.NotepadCCExternalScriptsAdded) {
      let jquery = document.createElement("script");
      jquery.src = "https://code.jquery.com/jquery-3.7.1.min.js";
      document.head.appendChild(jquery);
      let semanticJS = document.createElement("script");
      semanticJS.src =
        "https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/2.5.0/semantic.min.js";
      document.head.appendChild(semanticJS);

      let darkreader = document.createElement("script");
      darkreader.src =
        "https://cdn.jsdelivr.net/npm/darkreader@4.9.58/darkreader.min.js";
      darkreader.onload = function () {
        DarkReader.setFetchMethod(window.fetch);
        if (!oc.character.customData.darkmode)
          oc.character.customData.darkmode = true;
        window.isDarkMode = oc.character.customData.darkmode;
        if (isDarkMode) {
          window.DarkReader.enable();
          darkModeBtn.innerHTML = '<i class="sun icon"></i>';
        } else {
          window.DarkReader.disable();
          darkModeBtn.innerHTML = '<i class="moon icon"></i>';
        }
      };
      document.head.appendChild(darkreader);
      window.NotepadCCExternalScriptsAdded = true;
    }
  },
};

oc.thread.on("MessageAdded", async ({ message }) => {
  // Open window if user sends `/notepad` or `/np`.
  let m = message;
  if (
    m.author == "user" &&
    ["/notepad", "/np"].find((a) => m.content.startsWith(a))
  ) {
    await window.NotepadCC.setWindowHTML();
    oc.window.show();
    m.expectsReply = false;

    if (!oc.character.customData.notepads)
      oc.character.customData.notepads = { default: "" };
    window.savedRecently = true;
    window.NotepadCC.populateNotepadSelect();
    window.NotepadCC.changeNotepad();
    setTimeout(() => oc.thread.messages.pop(), 10);
  }
});
oc.window.hide(); // Hide window if loading the thread for first time.

if (oc.thread.messages.length === 0) {
  oc.thread.messages.push({
    author: "ai",
    content: `Notepad Window 
1. Copy the code below  
2. Edit Character Custom Code  
3. Paste (see [this Perchance Document on how to add Custom Codes](https://docs.google.com/document/d/1z-L-M5PpHuI3Nz7R_mWOuwr0w_ElTxgzzqsYJND65Fs/edit?tab=t.7ojuif281el#heading=h.fs7j6itnshc3))
\n\`\`\`javascript|js\n${oc.character.customCode.split("\n").slice(0, -13).join("\n")}\n\`\`\``,
    hiddenFrom: ["ai"],
    expectsReply: false,
  });
}