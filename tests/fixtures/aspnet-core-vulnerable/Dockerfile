FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY Acme.Portal.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0.20 AS final
WORKDIR /app
ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
COPY --from=build /app/publish .
RUN mkdir -p /var/acme/exports /var/acme/device-logs /var/acme/documents /app/wwwroot/uploads/avatars \
    && chown -R app:app /var/acme /app/wwwroot
USER app
ENTRYPOINT ["dotnet", "Acme.Portal.dll"]
