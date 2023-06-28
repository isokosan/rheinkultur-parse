### New Issue Checklist
- [x] I am not disclosing a [vulnerability](https://github.com/parse-community/parse-server/blob/master/SECURITY.md).
- [x] I am not just asking a [question](https://github.com/parse-community/.github/blob/master/SUPPORT.md).
- [x] I have searched through [existing issues](https://github.com/parse-community/parse-server/issues?q=is%3Aissue).
- [x] I can reproduce the issue with the [latest version of Parse Server](https://github.com/parse-community/parse-server/releases). <!-- We don't investigate issues for outdated releases. -->

### Issue Description
Returning a compound query (with `Parse.Query.and` or `Parse.Query.or`) that has a `matchesQuery` clause, inside a `beforeFind` function is not giving the same result, as running the query outside of the beforeFind function.

### Steps to reproduce
I'm sharing a basic example, which should be easy to reproduce. The `matchesQuery` does not have to be a pointer, I've tried other simpler queries like string matching, or not equal to null, etc.
```
Parse.Cloud.beforeFind('PhotoObject', async ({ query, user, master }) => {
  if (master) { return }
  // if public, just return clean and approved photos.
  if (!user) {
    query.equalTo('approved', true)
    return
  }
  // if there is a user, return the photos from users only of that company or approved photos from other companies
  const userQuery = new Parse.Query(Parse.User)
  userQuery.equalTo('company', user.get('company'))
  const newQuery = Parse.Query.and(
    query,
    Parse.Query.or(
      $query('CubePhoto').equalTo('approved', true),
      $query('CubePhoto').matchesQuery('createdBy', userQuery)
    )
  )
  return newQuery
})
```

### Actual Outcome
I get consistently an empty response when running queries with a user from the client.
When I run `find` on the `newQuery` with master key before returning it, and log the output I get expected results on the server.

### Expected Outcome
The response should be the same as when I execute a find the `newQuery` on the server side before returning it in the `beforeFind`, as should be sent to the client side.

I can confirm the issue because if I retrieve the userQuery and substitute a `containedIn` for the `matchesQuery`, the query works as expected.
(Note: This is the way I went around it for now, and I use a `distinct` on the objectId to get around the limit and performance for now instead of `find`)

```
  const users = await userQuery.find({ useMasterKey: true })
  return Parse.Query.and(
    query,
    Parse.Query.or(
      $query('CubePhoto').equalTo('approved', true),
      $query('CubePhoto').containedIn('createdBy', users)
    )
  )
```

### Environment
<!-- Be specific with versions, don't use "latest" or semver ranges like "~x.y.z" or "^x.y.z". -->

Server
- Parse Server version: `FILL_THIS_OUT`
- Operating system: `FILL_THIS_OUT`
- Local or remote host (AWS, Azure, Google Cloud, Heroku, Digital Ocean, etc): `FILL_THIS_OUT`

Database
- System (MongoDB or Postgres): `FILL_THIS_OUT`
- Database version: `FILL_THIS_OUT`
- Local or remote host (MongoDB Atlas, mLab, AWS, Azure, Google Cloud, etc): `FILL_THIS_OUT`

Client
- SDK (iOS, Android, JavaScript, PHP, Unity, etc): `FILL_THIS_OUT`
- SDK version: `FILL_THIS_OUT`

### Logs
<!-- Include relevant logs here. Turn on additional logging by configuring VERBOSE=1 in your environment. -->
