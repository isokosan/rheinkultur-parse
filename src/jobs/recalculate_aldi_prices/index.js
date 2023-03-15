module.exports = async function (job) {
  const updatedInvoices = await Parse.Cloud.run('recalculate-gradual-invoices', { id: 'ALDI' }, { useMasterKey: true })
  return Promise.resolve({ updatedInvoices })
}
