const wait = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000))
module.exports = async function (job) {
  let i = 0
  while (true) {
    await wait(1)
    i++
    console.log({ i })
    job.progress(i)
    if (i === 100) {
      break
    }
  }
  return Promise.resolve({ i })
}
