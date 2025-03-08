oc.thread.on("MessageAdded", async function({message}) {
  let m = message;
  if (m.author == 'user') {
    oc.thread.messages.push({
      author: "system",
      hiddenFrom: ["user"],
      content: `The current time is: ${new Date(Date.now()).toString()}`
    })
  }
  if (m.author == "ai") {
    // let temp = oc.thread.messages.pop();
    // oc.thread.messages.pop()
    // oc.thread.messages.push(temp);
    oc.thread.messages.splice(-2,1);
  }
})